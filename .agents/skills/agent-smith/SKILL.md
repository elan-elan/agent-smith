---
name: agent-smith
description: Set up and run Agent Smith experiment loops for machine learning, data, and other iterative optimization repos. Use when a user wants an interactive workflow that identifies or scaffolds a `prepare.py`, `train.py`, and `program.md`-style setup, asks follow-up questions about missing pieces, chooses sensible defaults, and prepares a repo for repeatable keep-or-discard experiments.
---

# Agent Smith

Turn a repo into a small, repeatable experimentation harness using the templates and rules bundled in this skill, adapted to whatever files and problem definition the user already has.

Use the Agent Smith three-file pattern as the default shape:

- `prepare.py` for stable data prep and evaluation utilities
- `train.py` for the main mutable experiment surface
- `program.md` for the agent operating instructions

Use `uv` as the default Python package and execution layer:

- if `uv` is not found, install it first in a persistent base-shell location before doing anything else
- run Python entrypoints with `uv run`
- create `pyproject.toml` from `assets/pyproject-template.toml` if the repo does not already have one
- when a new dependency is required, add it with `uv add <package>` and keep `pyproject.toml` aligned immediately

Keep the workflow interactive. Ask a short setup questionnaire before creating or changing files. Ask in normal chat text; do not depend on special UI forms.

## Interactive Intake

Start by inspecting the repo for candidate files, then ask the user a compact confirmation message with defaults filled in. Keep the first round to the minimum needed to proceed.

Ask for:

1. the data-prep/download entrypoint to treat as `prepare.py`
2. the training/experiment entrypoint to treat as `train.py`
3. the instructions file to treat as `program.md`
4. the objective metric, whether higher or lower is better, and the per-run budget
5. the git tracking preference: local git only, or git plus a remote such as GitHub

If the user wants remote tracking, ask for the repository URL up front. A GitHub link is not strictly required to run Agent Smith, but it is useful if the user wants commits pushed, changes backed up remotely, or experiment branches reviewed outside the local machine.

If the repo is already committed to git, do not default to committing autotuning runs on `main`. Ask whether to create a dedicated experiment branch first, and default to yes.

If a file is missing, ask one-by-one whether to create it from scratch based on the user's description. Use this pattern:

- `prepare.py` missing: ask whether to create it, and if yes ask for the data source, raw format, preprocessing steps, prepared outputs, and any download command or auth constraints
- `train.py` missing: ask whether to create it, and if yes ask for the task type, target, model family or baseline preference, metric, dependency limits, and runtime constraints
- `program.md` missing: ask whether to create it, and if yes ask for the mutable files, fixed files, run command, metric contract, and keep/discard policy

If the user does not care about the details, fall back to the default templates and fill in the minimum sensible values.

If Agent Smith creates `program.md` for the user, explicitly remind them afterward to edit it and add custom instructions that better fit their workflow before any long autonomous run.

If a file is missing, say what you will use as the default:

- no prep script: create `prepare.py` from `assets/prepare-template.py`
- no train script: create `train.py` from `assets/train-template-generic.py` or `assets/train-template-tabular.py`
- no instructions file: create `program.md` from `assets/program-template.md`

Ask follow-up questions only when they unblock scaffolding, for example:

- task type
- dataset path or download command
- target column or label field
- existing dependency constraints
- hardware/runtime constraints

## Defaults And Discovery

Read `references/defaults-and-scaffolding.md` before proposing defaults.

Prefer existing files over renaming everything to match the default skill layout. If the repo already uses `fit.py`, `main.py`, `download_kaggle.py`, or some other entrypoint, keep that structure unless the user explicitly wants the canonical `prepare.py` / `train.py` / `program.md` naming.

## Setup Workflow

1. inspect the repo and resolve the prep, train, and instructions paths
2. check whether `uv` is available; if not, install it first and verify `uv --version`
3. inspect or create `pyproject.toml` and standardize Python commands around `uv run`
4. inspect the git state and ask whether changes should stay local or also be pushed to a remote
5. if the repo already has commits and the current branch is a default branch such as `main` or `master`, create a dedicated experiment branch before autotuning
6. confirm the metric contract and runtime budget
7. initialize `results.tsv` with a header row if the repo does not already have an experiment log
8. keep immutable setup/evaluation separate from mutable experiment logic where possible
9. scaffold missing files only after inspection and user confirmation of the defaults
10. summarize the final contract before kicking off experiment work

Leave the repo with:

- a resolved prep entrypoint
- a resolved train entrypoint
- a resolved instructions file
- a runnable baseline command
- a clear git tracking plan, including remote URL if the user wants pushes
- a dedicated experiment branch when autotuning should not touch `main`
- a baseline result recorded before aggressive experimentation begins
- a clear metric contract for later keep/discard runs

## Scaffolding Rules

When creating missing files:

- keep the first version small and easy to edit
- prefer the repo's existing libraries and conventions
- make the train entrypoint print a machine-readable final summary
- put tunable hyperparameters or knobs near the top of the training file
- make the baseline deterministic enough for A/B comparison
- use `uv run` in commands and instructions instead of raw `python`

When package management is needed:

- check `which uv` before assuming it exists
- if `uv` is missing, install it first in a non-conda base-shell location and make sure future shells can see it
- prefer existing dependencies first
- if a new package is required, add it to the project immediately with `uv add <package>`
- do not hand-edit the dependency list without also running the matching `uv add`
- if `pyproject.toml` is missing, create it from `assets/pyproject-template.toml` before adding packages
- if `uv` installation is blocked by sandbox or network policy, surface the exact install command and request approval, then verify the install before continuing
- if `uv add` is blocked by sandbox or network policy, surface the exact command and request approval, then run it once approved

If the user provides only data or a data-download script, synthesize a minimal baseline training script around the detected data format and installed dependencies. For tabular CSV problems, start from the simplest runnable classification or regression baseline you can justify after inspecting columns and labels.

If no `prepare.py` exists, start from `assets/prepare-template.py` and replace the placeholders with repo-specific data logic.

If no `train.py` exists, start from `assets/train-template-generic.py`. Use `assets/train-template-tabular.py` instead when the task is clearly CSV/tabular and the dependencies fit.

If no `program.md` exists, adapt `assets/program-template.md` and fill in its placeholders with the resolved paths, metric, budget, and commands.

If Agent Smith generated `program.md`, remind the user that it is only a baseline and should be customized with repo-specific instructions, branch conventions, and experiment preferences.

If the repo is already under git and has a committed baseline, keep `main` as the stable branch and run autotuning on a separate branch such as `agent-smith/<tag>` or `experiments/<tag>`.

## Experiment Loop Contract

Favor the three-file split when possible:

- prep/eval stays stable
- training code is the main mutable surface
- instructions describe how the agent should run and judge experiments

Adapt these default loop rules unless the user explicitly wants a different process:

- the first run on a fresh experiment branch should always be the unmodified baseline
- make one experiment-sized change at a time
- if git tracking is enabled, commit each experiment separately
- redirect full training output to `run.log` instead of flooding the context
- read the final metric block from `run.log`
- if the final metric block is missing, inspect the last lines of `run.log`, attempt an easy fix, and otherwise mark the run as a crash
- record every run in `results.tsv` using tab-separated fields
- if the metric improved in the desired direction, keep the change and advance from there
- if the metric is equal or worse, revert or discard the experiment if the workflow is commit-per-idea
- prefer simpler changes when gains are similar

Use a hard timeout. A good default is roughly 2x the per-run budget. If a run exceeds that limit, stop it and treat it as a failed experiment.

If the user explicitly wants autonomous mode, do not pause between experiments unless blocked by missing credentials, missing data, or another hard blocker. Continue until interrupted.

After a run batch is complete, or when the user asks for a recap, run the bundled `scripts/summarize_results.py` against `results.tsv` to generate:

- `results_summary.md`
- `progress.svg`

Prefer `uv run python .agents/skills/agent-smith/scripts/summarize_results.py results.tsv --goal <higher|lower>` when the skill is vendored into the repo at that path.

## Resources

- Read `references/defaults-and-scaffolding.md` for candidate path order, follow-up questions, and scaffold heuristics.
- Run `scripts/summarize_results.py` after completed experiment batches to summarize `results.tsv` and generate a plot.
- Adapt `assets/pyproject-template.toml` when the repo has no `pyproject.toml`.
- Adapt `assets/prepare-template.py` when the repo has no prep script.
- Use `assets/program-template.md` when the repo has no usable instructions file.
- Adapt `assets/train-template-generic.py` when the repo has no training script and the task is not obviously tabular.
- Adapt `assets/train-template-tabular.py` when the user has a CSV-style task and no training script.
