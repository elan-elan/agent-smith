# Experiment Program

This repository uses an Agent Smith experiment loop for binary insurance claim classification.

## Setup

To set up a new run, work with the user to:

1. agree on a run tag or branch name
2. resolve the core paths:
   - prep: `prepare.py`
   - train: `train.py`
   - instructions: `program.md`
3. read the in-scope files for full context
4. verify that prepared data exists or that the prep command is runnable
5. run Python commands with `uv`
6. initialize a simple experiment log such as `results.tsv` if the repo does not already have one
7. confirm the baseline command and metric contract

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

Default prep command:

```bash
uv run prepare.py
```

Default run command:

```bash
uv run train.py
```

Default budget per run: `300s`

If a new Python dependency is required during experimentation, add it with:

```bash
uv add <package>
```

so `pyproject.toml` stays in sync.

### Mutable surface

By default, modify:

- `train.py`

Avoid modifying:

- `prepare.py`

unless the user explicitly broadens the search space.

## Logging

Record experiments in a simple tab-separated file when helpful:

```text
commit	metric	status	description
```

Use `keep`, `discard`, or `crash` for status unless the repo already has a different convention.

## Loop

Repeat:

1. inspect the current repo state
2. make one experiment-sized change
3. run the training command
4. read the final metric block
5. record the result
6. keep or discard the change based on whether it improved `val_auc`

## Guardrails

- prefer small, reviewable diffs
- keep the baseline runnable at all times
- when a dependency is required, prefer `uv add` over manual dependency edits
- allow model-search and resampling experiments, but keep the held-out split fixed and untouched
- prefer simpler changes when gains are similar
