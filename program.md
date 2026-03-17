# Experiment Program

This repository uses an Agent Smith experiment loop for binary insurance claim classification.
Experiments are run in **Python** (via `uv`), sharing the same
`results.tsv`, metric contract, and edit → run → commit/revert cycle.

## Setup

To set up a new run, work with the user to:

1. agree on a run tag or branch name
2. resolve the core paths (see Python section below)
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

## Logging

Record experiments in a simple tab-separated file:

```text
commit	metric	status	description
```

Use `keep`, `discard`, or `crash` for status unless the repo already has a different convention.

## Guardrails

- the agent itself drives each iteration — do not write batch runners or meta-scripts
- the committed state of `train.py` should always reflect the current best
- never start a new experiment with a non-improving change still in the working tree
- prefer small, reviewable diffs
- keep the baseline runnable at all times
- prefer `uv add` over manual dependency edits
- allow model-search and resampling experiments, but keep the held-out split fixed and untouched
- prefer simpler changes when gains are similar
