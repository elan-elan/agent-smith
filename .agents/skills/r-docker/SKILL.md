---
name: r-docker
description: Run R models and visualizations via Docker (rocker/r-ver:latest) without requiring a local R installation. Use when the user wants to fit statistical models (MARS/earth, glm, lm, gam), run R packages (earth, e1071, ggplot2, caret), or produce publication-quality plots — all executed inside a disposable Docker container. Supports CSV input, automatic data conversion, custom train/test splits, evaluation requirements via markdown, and integration with agent-smith experiment loops for hyperparameter tuning.
---

# R-Docker

Run any R workflow inside a Docker container. No local R installation needed — only Docker.

## Hard Rules

- **Docker is the only way to run R.** Do not install R locally via Homebrew, apt, conda, or any other package manager. Do not use `rpy2`, `pyearth`, `sklearn-contrib-py-earth`, or any Python bridge/reimplementation of an R package.
- If Docker is not installed or not running, **stop and ask the user to start or install Docker**. Do not fall back to local R or Python substitutes.
- Every R execution goes through `scripts/r_worker.sh` (experiment loop) or `scripts/run_r.sh` (one-off). No exceptions.
- **Never call `install.packages()` inside a train.R script.** Packages are installed once at worker startup or via `r_worker.sh install`. Scripts use `suppressPackageStartupMessages(library(...))` only.

## When to Use

Any request involving R, CRAN packages, or R-specific model families: MARS/earth, glm, lm, gam, ggplot2, e1071, randomForest, ranger, xgboost via R, glmnet, caret, etc.

## Two Execution Modes

| Mode | Script | Use for |
|---|---|---|
| **One-off** | `scripts/run_r.sh` | Single model fit, visualization, CI/CD |
| **Experiment loop** | `scripts/r_worker.sh` | Agent-smith integration, hyperparameter tuning |

One-off uses `docker run --rm` with a package cache volume. Experiment loop keeps a persistent container — near-zero overhead per run.

See [references/docker-execution.md](./references/docker-execution.md) for full command reference, subcommands, data handling, and script generation rules.

## Integration with Agent Smith

The R script becomes the mutable experiment surface (like `train.py`), and the worker container stays hot across iterations.

### Setup

1. Start the worker with required packages:
   ```bash
   bash scripts/r_worker.sh start data/prepared r_output -- earth e1071
   ```
2. Set `program.md` to use: `bash scripts/r_worker.sh run train.R 300`
3. Copy `assets/r-template-tabular-classification.R` to `train.R` as starting point
4. Record a baseline before tuning

### Experiment cycle

Same edit → run → record → commit/revert cycle as agent-smith. The R script must print:

```
===== METRICS =====
val_auc: 0.6523
===================
```

### Teardown

```bash
bash scripts/r_worker.sh stop
```

### Adding packages mid-loop

```bash
bash scripts/r_worker.sh install randomForest xgboost
```

No restart needed.

## Multi-Model Experiments

Read [references/r-model-cookbook.md](./references/r-model-cookbook.md) **before writing any R model code**. It contains:

- API quick reference for all 7 model families (glm, earth, randomForest, ranger, xgboost, glmnet, svm)
- Known pitfalls per model
- Runtime expectations
- Recommended exploration order (fast → slow)
- One-hot encoding helper for matrix-based models
- Standard package set for worker startup

## Resources

### References
- [references/r-model-cookbook.md](./references/r-model-cookbook.md) — model APIs, pitfalls, runtime expectations
- [references/docker-execution.md](./references/docker-execution.md) — full Docker command reference, data handling, script generation, workflows

### Templates
- `assets/r-template-tabular-classification.R` — **primary template** for classification (7 model families, single CONFIG section)
- `assets/r-template-prepare.R` — data preparation (analogous to prepare.py)
- `assets/r-template-earth.R`, `assets/r-template-glm.R` — single-model templates (legacy)
- `assets/r-template-ggplot2.R` — visualization template
- `assets/r-template-generic.R` — generic R script skeleton
- `assets/r-task-template.md` — task description template

### Scripts
- `scripts/run_r.sh` — one-off Docker execution (with package cache volume)
- `scripts/r_worker.sh` — persistent container for experiment loops
- `scripts/csv_convert.py` — data format conversion helper
