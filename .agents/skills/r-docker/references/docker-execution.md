# Docker Execution Reference

Detailed procedural reference for running R via Docker. The SKILL.md provides the overview;
this file has the full commands, data handling, script generation rules, and workflow checklists.

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

Convert to CSV before mounting:

| Source format | Conversion method |
|---|---|
| `.npy` | `python3 -c "import numpy as np; a=np.load('file.npy'); np.savetxt('file.csv', a.reshape(-1,1) if a.ndim==1 else a, delimiter=',')"` |
| `.parquet` | `python3 -c "import pandas as pd; pd.read_parquet('file.parquet').to_csv('file.csv', index=False)"` |
| `.tsv` | `python3 -c "import pandas as pd; pd.read_csv('file.tsv', sep='\t').to_csv('file.csv', index=False)"` |
| `.json` | `python3 -c "import pandas as pd; pd.read_json('file.json').to_csv('file.csv', index=False)"` |
| `.xlsx` | `python3 -c "import pandas as pd; pd.read_excel('file.xlsx').to_csv('file.csv', index=False)"` |

Use `scripts/csv_convert.py` for automated detection and conversion. Clean up temporary CSV files unless the user wants to keep them.

### Data Splitting

- If the user provides separate train/test files, use them as-is
- If they provide a single file, generate R code that splits inside the script (using `sample()` or `caret::createDataPartition()`)
- Default split: 80/20 with a fixed seed for reproducibility
- Respect stratification requests

## R Script Generation

Every generated R script must:

1. **Handle packages correctly** based on execution mode:
   - **One-off mode** (`run_r.sh`): include idempotent `install.packages()` at the top (the package cache volume avoids recompilation):
     ```r
     for (pkg in c("earth", "e1071")) {
       if (!requireNamespace(pkg, quietly = TRUE))
         install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
     }
     ```
   - **Experiment loop mode** (`r_worker.sh`): do NOT call `install.packages()`. Packages are pre-installed at worker startup. Use only:
     ```r
     suppressPackageStartupMessages(library(earth))
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

Use the templates in `assets/` as starting points.

## One-off Mode (`run_r.sh`)

For single runs or infrequent use. Uses `docker run --rm` with a **named volume** (`r-pkg-cache`) so packages are compiled once and cached across runs.

```bash
bash scripts/run_r.sh <r_script> <data_dir> [output_dir] [timeout_seconds]
```

Example:

```bash
bash scripts/run_r.sh train_earth.R data/prepared r_output 300 2>&1 | tee run.log
```

Cost per run: ~1-2s container overhead + script execution time.

## Experiment Loop Mode (`r_worker.sh`)

A persistent container stays running; each experiment is a near-instant `docker exec`.

### Lifecycle

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

### Subcommands

| Command | Description |
|---|---|
| `start <data_dir> [output_dir] [-- pkg...]` | Create container, mount data/output, install packages |
| `run <r_script> [timeout]` | Copy script in and execute via `docker exec` |
| `install <pkg1> [pkg2 ...]` | Add packages to running worker |
| `status` | Check if worker is running, list installed packages |
| `stop` | Destroy worker container |

Cost per run: script execution time only (~0s overhead).

### Capturing output

```bash
bash scripts/r_worker.sh run train.R 300 2>&1 | tee run.log
grep -A 100 "===== METRICS =====" run.log
```

## Which Mode to Use

| Situation | Mode | Script |
|---|---|---|
| Single model fit or visualization | One-off | `run_r.sh` |
| Agent-smith experiment loop | Worker | `r_worker.sh` |
| Hyperparameter tuning (many runs) | Worker | `r_worker.sh` |
| CI/CD or reproducibility check | One-off | `run_r.sh` |

## User Instructions via Markdown

When the user provides requirements (split, evaluation criteria, hyperparameters), store them as `r_task.md`:

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

## Workflow: One-off Task

1. Inspect the user's data (format, shape, columns, target)
2. Convert to CSV if needed
3. Generate the R script from templates
4. Create a task markdown if the user provides requirements
5. Verify Docker is running
6. Run via `bash scripts/run_r.sh`
7. Capture output to `run.log`
8. Extract metrics from the METRICS block
9. Report results; save generated plots

## Workflow: Experiment Loop (Agent-Smith)

The full setup, experiment cycle, teardown, and mid-loop package install steps are defined in the SKILL.md "Integration with Agent Smith" section. Follow those steps — they are the canonical source.

Additional details specific to Docker execution:
- The worker's data mount is read-only; output mount is read-write
- `docker cp` is used internally by `r_worker.sh run` to copy the script in before each execution
- Package installation via `r_worker.sh install` runs inside the existing container — no restart needed

## Hybrid: R Model inside train.py

Keep `train.py` as the experiment surface and shell out to R:

```python
import subprocess, re

result = subprocess.run(
    ["bash", "scripts/r_worker.sh", "run", "model.R", str(RUN_BUDGET_SECONDS)],
    capture_output=True, text=True, timeout=RUN_BUDGET_SECONDS + 30
)
match = re.search(r"val_auc:\s*([\d.]+)", result.stdout)
val_auc = float(match.group(1)) if match else None
```
