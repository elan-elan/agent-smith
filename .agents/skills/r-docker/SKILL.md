---
name: r-docker
description: Run R models and visualizations via Docker (rocker/r-ver:latest) without requiring a local R installation. Use when the user wants to fit statistical models (MARS/earth, glm, lm, gam), run R packages (earth, e1071, ggplot2, caret), or produce publication-quality plots — all executed inside a disposable Docker container. Supports CSV input, automatic data conversion, custom train/test splits, evaluation requirements via markdown, and integration with agent-smith experiment loops for hyperparameter tuning.
---

# R-Docker

Run any R workflow inside a Docker container. No local R installation needed — only Docker.

## Hard Rules

- **Docker is the only way to run R.** Do not install R locally via Homebrew, apt, conda, or any other package manager. Do not use `rpy2`, `pyearth`, `sklearn-contrib-py-earth`, or any Python bridge/reimplementation of an R package.
- If Docker is not installed or not running, **stop and ask the user to start or install Docker**. Do not fall back to local R installation or Python substitutes.
- Every R execution goes through `scripts/r_worker.sh` (experiment loop) or `scripts/run_r.sh` (one-off). No exceptions.

Default contract:

- Docker image: `rocker/r-ver:latest`
- Input data: CSV files (convert other formats first)
- R script: generated per task, mounted or copied into the container
- Output: metrics printed to stdout, plots saved to a mounted output directory
- Two execution modes:
  - **One-off** (`run_r.sh`): `docker run --rm` with a package cache volume
  - **Experiment loop** (`r_worker.sh`): persistent container, packages installed once, fast `docker exec` per run

## When to Use

- "fit a MARS model using R"
- "fit a glm() on this data using R"
- "visualize this data with ggplot2 in R for publication"
- "run an earth model on my embeddings"
- "train an SVR with e1071 in R"
- "compare lm vs glm vs earth on this dataset"
- any request that mentions R, CRAN packages, or R-specific model families

## Prerequisites

Verify Docker is available before running anything:

```bash
docker info >/dev/null 2>&1 || { echo "Docker is not running"; exit 1; }
```

Pull the image once if not cached:

```bash
docker pull rocker/r-ver:latest
```

## Data Handling

### CSV Input

R reads CSV natively. If the user's data is already CSV, mount it directly.

### Non-CSV Input

Convert to CSV before mounting. Common conversions:

| Source format | Conversion method |
|---|---|
| `.npy` | `python3 -c "import numpy as np; a=np.load('file.npy'); np.savetxt('file.csv', a.reshape(-1,1) if a.ndim==1 else a, delimiter=',')"` |
| `.parquet` | `python3 -c "import pandas as pd; pd.read_parquet('file.parquet').to_csv('file.csv', index=False)"` |
| `.tsv` | `python3 -c "import pandas as pd; pd.read_csv('file.tsv', sep='\t').to_csv('file.csv', index=False)"` |
| `.json` | `python3 -c "import pandas as pd; pd.read_json('file.json').to_csv('file.csv', index=False)"` |
| `.xlsx` | `python3 -c "import pandas as pd; pd.read_excel('file.xlsx').to_csv('file.csv', index=False)"` |

Use the helper script `scripts/csv_convert.py` for automated detection and conversion.

After conversion, clean up temporary CSV files unless the user wants to keep them.

### Data Splitting

When the user specifies a train/test split:

- If they provide separate train/test files, use them as-is
- If they provide a single file, generate R code that splits inside the script (using `sample()` or `caret::createDataPartition()`)
- Default split: 80% train / 20% test with a fixed seed for reproducibility
- Respect stratification requests (e.g., stratified by target column)

## R Script Generation

Generate a self-contained R script for each task. Every generated script must:

1. **Install required packages** at the top (idempotent):
   ```r
   for (pkg in c("earth", "e1071")) {
     if (!requireNamespace(pkg, quietly = TRUE))
       install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
   }
   ```

2. **Accept the data directory as a command-line argument**:
   ```r
   args <- commandArgs(trailingOnly = TRUE)
   input_dir <- if (length(args) >= 1) args[1] else "/workspace/data"
   ```

3. **Print a machine-readable metrics block** at the end:
   ```r
   cat("\n===== METRICS =====\n")
   cat("metric_name:", metric_value, "\n")
   cat("===================\n")
   ```

4. **Save plots** to the output directory when visualization is requested:
   ```r
   output_dir <- if (length(args) >= 2) args[2] else "/workspace/output"
   dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)
   ```

Use the templates in `assets/` as starting points. Customize per task.

## Docker Execution

Two modes depending on context.

### One-off mode (`run_r.sh`)

For single runs or infrequent use. Uses `docker run --rm` but with a **named volume** (`r-pkg-cache`) for the R library, so packages are compiled once and cached across runs.

```bash
bash scripts/run_r.sh <r_script> <data_dir> [output_dir] [timeout_seconds]
```

Example:

```bash
bash scripts/run_r.sh train_earth.R data/prepared r_output 300 2>&1 | tee run.log
```

Cost per run: ~1-2s container overhead + script execution time. Package installs are cached.

### Experiment loop mode (`r_worker.sh`)

For agent-smith integration or any batch of sequential experiments. A persistent container stays running; each experiment is a near-instant `docker exec`.

#### Lifecycle

```bash
# 1. Start worker — create container, install packages once
bash scripts/r_worker.sh start data/prepared r_output -- earth e1071 ggplot2

# 2. Run experiments — fast, no container or package overhead
bash scripts/r_worker.sh run train.R 300 2>&1 | tee run.log

# 3. Edit train.R, run again (the experiment loop)
bash scripts/r_worker.sh run train.R 300 2>&1 | tee run.log

# 4. Install more packages on the fly if needed
bash scripts/r_worker.sh install xgboost randomForest

# 5. When done — clean up
bash scripts/r_worker.sh stop
```

#### Subcommands

| Command | Description |
|---|---|
| `start <data_dir> [output_dir] [-- pkg...]` | Create container, mount data/output, install packages |
| `run <r_script> [timeout]` | Copy script in and execute via `docker exec` |
| `install <pkg1> [pkg2 ...]` | Add packages to running worker |
| `status` | Check if worker is running, list installed packages |
| `stop` | Destroy worker container |

Cost per run: script execution time only (~0s overhead). Packages persist for the lifetime of the container.

### Which mode to use

| Situation | Mode | Script |
|---|---|---|
| Single model fit or visualization | One-off | `run_r.sh` |
| Agent-smith experiment loop | Worker | `r_worker.sh` |
| Hyperparameter tuning (many runs) | Worker | `r_worker.sh` |
| CI/CD or reproducibility check | One-off | `run_r.sh` |

### Capturing output

Both modes write to stdout. For metric extraction:

```bash
bash scripts/r_worker.sh run train.R 300 2>&1 | tee run.log
grep -A 100 "===== METRICS =====" run.log
```

## User Instructions via Markdown

When the user provides additional requirements (train/test split, evaluation criteria, specific hyperparameters, cross-validation, etc.), store them as a markdown file alongside the R script:

- `r_task.md` — human-readable task description and constraints
- Reference these instructions when generating the R script

Example task markdown:

```markdown
# Task: MARS Regression on Insurance Data

## Data
- Input: data/prepared/insurance_claims_prepared.csv
- Target column: claim_status

## Model
- Type: MARS (earth package)
- degree: 1-3 (tune)
- nprune: 10-50 (tune)

## Evaluation
- Split: 80/20 stratified
- Metrics: AUC, accuracy, F1
- Report confusion matrix

## Output
- Print all metrics in METRICS block
- Save variable importance plot
```

## Integration with Agent Smith

This skill plugs into the `agent-smith` experiment loop. The R script becomes the mutable experiment surface (like `train.py`), and the worker container stays hot across iterations.

### Setup

Before the experiment loop begins:

1. Start the persistent worker with the required packages:
   ```bash
   bash scripts/r_worker.sh start data/prepared r_output -- earth e1071
   ```
2. Create or adapt `program.md` to use R-docker commands:
   ```markdown
   ## Train command
   bash scripts/r_worker.sh run train.R 300
   ```
3. Set the mutable file to the `.R` script:
   ```markdown
   ## Mutable paths
   train.R
   ```
4. Record a baseline before tuning.

### Experiment loop cycle

Each iteration follows agent-smith's edit → run → commit/revert cycle:

1. **Edit** `train.R` — change hyperparameters, model family, preprocessing
2. **Commit** the change
3. **Run** `bash scripts/r_worker.sh run train.R 300 2>&1 | tee run.log`
4. **Read** metrics from `run.log`
5. **Record** in `results.tsv`
6. **Keep or revert** based on metric improvement

The R script must print the standard metrics block:

```
===== METRICS =====
val_auc: 0.6523
val_mse: 0.0412
===================
```

### Teardown

After the experiment batch completes:

```bash
bash scripts/r_worker.sh stop
```

Run `scripts/summarize_results.py` to generate the summary as usual.

### Hybrid: R model inside train.py

Alternatively, keep `train.py` as the experiment surface and shell out to R:

```python
import subprocess, re

result = subprocess.run(
    ["bash", "scripts/r_worker.sh", "run", "model.R", str(RUN_BUDGET_SECONDS)],
    capture_output=True, text=True, timeout=RUN_BUDGET_SECONDS + 30
)
# Parse metrics from R output
match = re.search(r"val_auc:\s*([\d.]+)", result.stdout)
val_auc = float(match.group(1)) if match else None
```

This lets the agent tune the R script OR the Python wrapper depending on what needs to change.

### Adding packages mid-loop

If the agent decides to try a different model family that needs a new package:

```bash
bash scripts/r_worker.sh install randomForest xgboost
```

No restart needed — packages install into the running container.

## Workflow

### One-off task

1. **Inspect** the user's data (format, shape, columns, target)
2. **Convert** to CSV if needed (using `scripts/csv_convert.py`)
3. **Generate** the R script from templates or from scratch
4. **Create** a task markdown if the user provides requirements
5. **Verify** Docker is running
6. **Run** via `bash scripts/run_r.sh` with appropriate paths
7. **Capture** output to `run.log`
8. **Extract** metrics from the METRICS block
9. **Report** results to the user
10. **Save** any generated plots to the output directory

### Experiment loop (agent-smith integration)

1. **Inspect** data, confirm metric contract and stop rule
2. **Convert** to CSV if needed
3. **Generate** the initial R script (baseline)
4. **Start** the worker: `bash scripts/r_worker.sh start <data_dir> <output_dir> -- <packages>`
5. **Record** baseline: run, extract metrics, record in `results.tsv`, commit
6. **Loop** (edit → run → record → keep/revert):
   - Edit hyperparameters or model in the `.R` script
   - `bash scripts/r_worker.sh run train.R 300 2>&1 | tee run.log`
   - Parse metrics, record in `results.tsv`
   - Commit if improved, revert if not
7. **Stop** the worker: `bash scripts/r_worker.sh stop`
8. **Summarize**: run `scripts/summarize_results.py`

## Multi-Model Experiment Loop

When running a batch of R experiments (via agent-smith), follow this pattern.

### Standard package set

Pre-install this package set when starting the worker. It covers all common classification
and regression models so you never need to restart mid-loop:

```bash
bash scripts/r_worker.sh start data/prepared r_output -- pROC earth randomForest ranger xgboost glmnet e1071
```

**Never call `install.packages()` inside a train.R script.** Packages are installed once at
worker startup. Scripts use `suppressPackageStartupMessages(library(...))` only.

### Starting template

Copy `assets/r-template-tabular-classification.R` to `train.R` in the project root.
This template supports 7 model families (glm, earth, randomForest, ranger, xgboost,
glmnet, svm) with a single CONFIG section at the top. Edit `MODEL_TYPE` and the
model-specific hyperparameters each experiment.

### Before writing any R model code

Read `references/r-model-cookbook.md`. It contains:

- Quick reference table for all 7 models (predict call, class weight arg, package)
- Known pitfalls per model (e.g., earth weights go on the `earth()` call not in `glm{}`,
  randomForest needs `as.factor(y)` for classification, xgboost needs `model.matrix()`)
- Runtime expectations (e.g., earth degree=3 on 50K rows takes 60–300s)
- Recommended exploration order (fast → slow)
- One-hot encoding helper for xgboost/glmnet/svm

### Recommended exploration order

Start with fast models and move to slower ones:

1. **glm** — instant baseline, always run first
2. **glmnet** — fast regularized linear, try alpha=0/0.5/1
3. **earth** — MARS, degree 1→2→3, increasing thresh
4. **ranger** — fast random forest, num.trees 500→1000
5. **xgboost** — gradient boosting, tune depth/eta/nrounds
6. **randomForest** — slower classic RF, use for comparison only
7. **svm** — slowest, try only if others plateau

### Runtime expectations

| Model | 50K rows | Notes |
|---|---|---|
| glm | <5s | Always works |
| glmnet | <5s | |
| earth (degree=1) | 5–15s | |
| earth (degree=2) | 15–60s | |
| earth (degree=3) | 60–300s | Avoid nfold>0 |
| ranger (500 trees) | 10–30s | |
| xgboost (100 rounds) | 5–20s | |
| randomForest (500 trees) | 30–120s | |
| svm (radial) | 120–600s | Consider subsampling |

Set timeout accordingly. Default 300s is fine for most; use 600s for svm.

## Resources

### Templates

- `assets/r-template-tabular-classification.R` — **Primary template for classification experiments.** Multi-model (glm, earth, randomForest, ranger, xgboost, glmnet, svm). Use this as the starting point for any tabular classification task.
- `assets/r-template-prepare.R` — Data preparation template (analogous to prepare.py). One-time preprocessing: drop columns, Yes/No→0/1, string→factor.
- `assets/r-template-earth.R` — MARS/earth regression-only template (legacy)
- `assets/r-template-glm.R` — GLM template (legacy)
- `assets/r-template-ggplot2.R` — ggplot2 visualization template
- `assets/r-template-generic.R` — Generic R script skeleton
- `assets/r-task-template.md` — Task description template

### References

- `references/r-model-cookbook.md` — **Read this before writing any R model code.** API quick reference, known pitfalls, runtime expectations, one-hot encoding helper.

### Scripts

- `scripts/run_r.sh` — One-off Docker execution (with package cache volume)
- `scripts/r_worker.sh` — Persistent container for experiment loops
- `scripts/csv_convert.py` — Data format conversion helper
