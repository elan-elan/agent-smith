# Experiment Program

If Agent Smith generated this file for you, treat it as a baseline. Edit it to add repo-specific instructions, branch conventions, experiment preferences, and any other workflow rules you want enforced before long autonomous runs.

This repository uses an Agent Smith experiment loop for `{{project_goal}}`.

## Setup

To set up a new run, work with the user to:

1. agree on a run tag or branch name
2. resolve the core paths:
   - prep: `{{prepare_path}}`
   - train: `{{train_path}}`
   - instructions: `{{program_path}}`
3. verify that `uv` is installed and available on `PATH`; if not, install it first
4. inspect the git state and confirm whether changes stay local or should also be pushed to a remote repository
5. if the repo already has a committed baseline and the current branch is `main` or another stable branch, create a separate experiment branch before autotuning
6. read the in-scope files for full context
7. verify that prepared data exists or that the prep command is runnable
8. verify that Python commands are run with `uv run`
9. initialize `results.tsv` with a header row if the repo does not already have one
10. confirm the baseline command and metric contract

## Experimentation

Each experiment should optimize `{{metric_name}}`, where `{{metric_goal}}` is better.

### Per-Experiment Time Budget

Each experiment has a hard wall-clock limit of **{{time_budget_minutes}} minutes**. If a single run exceeds this limit:

1. Kill the process (`kill %1` or equivalent)
2. Log it as `crash` in `results.tsv` with a description noting the timeout
3. Revert any mutable file changes
4. Move on to the next experiment

This prevents the loop from stalling on models or configurations that are too expensive to evaluate within the experiment cadence. If multiple experiments approach the time limit, simplify the model, reduce data size, or lower iteration counts before retrying the same idea.

The agent should actively explore:

- different model families
- different feature-selection and preprocessing choices
- different class-imbalance strategies such as upsampling, downsampling, and class weighting

The key evaluation rule is strict:

- keep the held-out test/validation split fixed across experiments
- never upsample or downsample the held-out test/validation split
- treat the held-out test/validation split as the natural class distribution
- apply any upsampling or downsampling only to the training portion of the data
- compare experiments only on the same fixed held-out split so metrics remain comparable

The first run on a fresh experiment branch should always be the unmodified baseline.

Stop condition for this batch:

`{{stop_rule}}`

Default run command:

```bash
{{train_command}}
```

If a new Python dependency is required during experimentation, add it with `uv add <package>` so `pyproject.toml` stays in sync.

### Mutable surface

By default, modify:

- `{{mutable_paths}}`

Avoid modifying:

- `{{fixed_paths}}`

unless the user explicitly broadens the search space.

All else equal, prefer simpler changes. A tiny gain that adds a lot of complexity is usually not worth keeping. An equally good or better result with less complexity is a strong outcome.

## Output Format

Make the training script print a final summary block. Prefer a machine-readable block like:

```text
---
primary_metric:    0.123456
metric_name:       {{metric_name}}
metric_goal:       {{metric_goal}}
training_seconds:  300.0
total_seconds:     318.4
status:            ok
```

Read the summary from `run.log` after each run instead of relying on streamed output.

Example:

```bash
grep "^primary_metric:\|^status:" run.log
```

## Logging

Record experiments in `results.tsv` using tab-separated fields:

```text
experiment	{{metric_name}}	status	commit	description
```

- **experiment**: sequential integer starting at 1
- **status**: one of `keep`, `discard`, or `crash`
- **commit**: short git hash from `git rev-parse --short HEAD` after committing kept code; empty for `discard` and `crash`

Append one row immediately after each experiment — never batch or defer. The commit hash lets the agent (or the user) checkout any kept experiment’s exact code state later via `git checkout <hash>`.

## Loop

Repeat:

1. inspect the current repo state
2. if this branch has no baseline result yet, run the baseline as-is and record it
3. otherwise make one experiment-sized change
4. run the training command as `{{train_command}} 2>&1 | tee run.log`
5. read the final metric block from `run.log`
6. if the final metric block is missing, inspect `tail -n 50 run.log`, attempt an easy fix, and otherwise record a crash
7. **if improved**: commit the mutable file(s) first (`git add <files> && git commit`), then capture `COMMIT=$(git rev-parse --short HEAD)`
8. **if not improved or crash**: revert the mutable file(s) (`git checkout -- <file>`), set `COMMIT=""`
9. **immediately** record the result in `results.tsv` via a single `printf` line — including `$COMMIT`
10. commit `results.tsv` separately: `git add results.tsv && git commit -m "results: exp N"`
11. stop when the batch-level stop rule above has been reached

## Guardrails

- the agent itself drives each iteration — do not write batch runners or meta-scripts
- the committed state of the mutable file(s) should always reflect the current best
- never start a new experiment with a non-improving change still in the working tree
- prefer small, reviewable diffs
- keep the baseline runnable at all times
- do not commit exploratory autotuning runs directly to `main` when a stable committed baseline already exists
- infer per-run runtime from the baseline or the last comparable successful run, because different model families may take very different amounts of time
- use a hard timeout of roughly 2x that inferred runtime
- avoid dependency churn unless the user approves it
- when a dependency is required, prefer `uv add` over manual dependency edits
- allow model-search and resampling experiments, but keep the held-out split fixed and untouched
- prefer simpler changes when gains are similar

If the user explicitly starts autonomous mode, continue running experiments until interrupted or until the batch-level stop rule is reached, unless you hit a hard blocker.

## Wrap-up

After a completed run batch, summarize and visualize the experiment history from `results.tsv`.

If this repo vendors Agent Smith under `.agents/skills/agent-smith`, run:

```bash
uv run python .agents/skills/agent-smith/scripts/summarize_results.py results.tsv --goal {{metric_goal}}
```

This should generate:

- `results_summary.md`
- `progress.svg`
