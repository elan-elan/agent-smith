# Experiment Program

This repository uses an Agent Smith experiment loop for binary insurance claim classification.
Experiments can be run in **Python** (via `uv`) or **R** (via Docker). Both share the same
`results.tsv`, metric contract, and edit → run → commit/revert cycle.

## Setup

To set up a new run, work with the user to:

1. agree on a run tag or branch name
2. resolve the core paths (see Python or R section below)
3. read the in-scope files for full context
4. verify that prepared data exists or that the prep command is runnable
5. initialize `results.tsv` if it does not already exist
6. confirm the baseline command and metric contract

## Experimentation

Each experiment should optimize `val_auc`, where higher is better.

The agent should actively explore:

- different model families
- different feature-selection and preprocessing choices
- different class-imbalance strategies such as upsampling, downsampling, and class weighting

The key evaluation rule is strict:

- keep the held-out test/validation split fixed across experiments
- never upsample or downsample the held-out test/validation split
- treat the held-out test/validation split as the natural class distribution
- apply any upsampling or downsampling only to the training portion of the data
- compare experiments only on the same fixed held-out split so AUC remains comparable

Default budget per run: `300s`

---

## Python Experimentation

### Paths

- prep: `prepare.py`
- train: `train.py` (mutable surface)
- instructions: `program.md`

### Commands

Prep command:
```bash
uv run prepare.py
```

Run command:
```bash
uv run train.py 2>&1 | tee run.log
```

Add dependencies:
```bash
uv add <package>
```

### Mutable surface

Modify `train.py`. Avoid modifying `prepare.py` unless the user explicitly broadens the search.

### Loop

1. review what has worked so far
2. choose the next experiment idea
3. edit `train.py` directly — the code change IS the experiment
4. run: `uv run train.py 2>&1 | tee run.log`
5. read the final metric block from `run.log`
6. record in `results.tsv`
7. **if improved**: `git add train.py && git commit -m "description val_auc=X.XXXXXX"`
8. **if not improved**: `git checkout train.py`

---

## R Experimentation

### Prerequisites

- Docker must be running (`docker info >/dev/null 2>&1`)
- Copy `r_worker.sh` and `run_r.sh` from the r-docker skill to `scripts/`
- Read `references/r-model-cookbook.md` from the r-docker skill before writing any R code

### Paths

- prep: `prepare.R` (optional — Python `prepare.py` output works for R too)
- train: `train.R` (mutable surface — copy from `r-template-tabular-classification.R`)
- instructions: `program.md`

### Setup commands

Start the worker with all common packages:
```bash
bash scripts/r_worker.sh start data/prepared r_output -- pROC earth randomForest ranger xgboost glmnet e1071
```

### Run command

```bash
bash scripts/r_worker.sh run train.R 300 2>&1 | tee run.log
```

### Teardown

```bash
bash scripts/r_worker.sh stop
```

### Mutable surface

Modify `train.R`. Edit the CONFIG section: `MODEL_TYPE`, hyperparameters, preprocessing flags.
Do not modify `prepare.py` / `prepare.R` unless the user explicitly broadens the search.

### Package management

- All packages pre-installed at worker startup (never call `install.packages()` in `train.R`)
- Add packages mid-loop: `bash scripts/r_worker.sh install <pkg>`

### Loop

1. review what has worked so far
2. choose the next experiment idea
3. edit `train.R` directly — the code change IS the experiment
4. run: `bash scripts/r_worker.sh run train.R 300 2>&1 | tee run.log`
5. read the final metric block from `run.log`
6. record in `results.tsv`
7. **if improved**: `git add train.R && git commit -m "description val_auc=X.XXXXXX"`
8. **if not improved**: `git checkout train.R`

---

## Logging

Record experiments in a simple tab-separated file:

```text
commit	metric	status	description
```

Use `keep`, `discard`, or `crash` for status unless the repo already has a different convention.
Python and R experiments share the same `results.tsv`.

## Guardrails

- the agent itself drives each iteration — do not write batch runners or meta-scripts
- the committed state of the mutable file (`train.py` or `train.R`) should always reflect the current best
- never start a new experiment with a non-improving change still in the working tree
- prefer small, reviewable diffs
- keep the baseline runnable at all times
- Python: prefer `uv add` over manual dependency edits
- R: never call `install.packages()` in train.R — use worker startup or `r_worker.sh install`
- allow model-search and resampling experiments, but keep the held-out split fixed and untouched
- prefer simpler changes when gains are similar
