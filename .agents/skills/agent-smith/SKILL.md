---
name: agent-smith
description: Create or adapt lightweight experiment harnesses for machine learning, data, and iterative optimization repos. Use when Codex needs to inspect or scaffold a `prepare.py` / `train.py` / `program.md` style workflow, standardize Python execution with `uv`, set up git-safe experimentation, and run repeatable keep-or-discard experiment loops with logged results.
---

# Agent Smith

Turn a repo into a small, repeatable experimentation harness.

Default contract:

- `prepare.py` for stable data prep and evaluation utilities
- `train.py` for the main mutable experiment surface
- `program.md` for the agent operating instructions
- `uv` for Python execution and dependency management

Prefer the repo's existing structure over renaming files just to match the default names.

## Non-Python Runtimes (R, Julia, etc.)

The experiment loop is not limited to Python models. When the user requests a model family that lives in another language — such as MARS/earth in R — delegate execution to the appropriate runtime skill.

For **R models**, use the **r-docker** skill. This means:

- Run R code inside Docker via `scripts/r_worker.sh` (experiment loop) or `scripts/run_r.sh` (one-off). The r-docker skill has the full contract.
- The mutable experiment surface becomes an `.R` script (e.g., `train_earth.R`) instead of `train.py`. Both can coexist — some experiments edit `train.py`, others edit the `.R` script.
- Metric output must still follow the standard metrics block format so `results.tsv` stays consistent across Python and R experiments.
- Copy the r-docker helper scripts (`r_worker.sh`, `run_r.sh`) into the repo's `scripts/` directory if they are not already there.

**Hard rule:** never install R locally (`brew install r`, `conda install r-base`, etc.), never use Python-to-R bridges (`rpy2`), and never substitute a Python reimplementation (`pyearth`, `sklearn-contrib-py-earth`) when the user asks for an R package. The r-docker skill exists precisely to avoid these workarounds. If Docker is unavailable, surface the problem and ask the user — do not silently switch strategies.

## Progressive Disclosure

Read `references/defaults-and-scaffolding.md` before proposing defaults.

Load it when you need:

- candidate path order
- exact intake prompts
- scaffold heuristics
- git defaults
- package-management details
- `program.md` adaptation rules

## Interactive Intake

Inspect the repo first, then ask one short confirmation message with inferred defaults. Keep the first round minimal and ask follow-ups only when they unblock scaffolding.

Confirm:

1. the prep entrypoint
2. the training entrypoint
3. the instructions file
4. the metric contract
5. one batch-level stop rule, if the user has not already provided one
6. the git tracking preference

If remote tracking is desired, ask for the repository URL. If the repo already has commits on `main`, `master`, or another stable branch, default to creating a separate experiment branch first.

If `prepare.py`, `train.py`, or `program.md` is missing, ask one-by-one whether to create it from scratch. If Agent Smith creates `program.md`, remind the user to customize it before any long autonomous run.

## Setup Workflow

1. resolve the prep, train, and instructions paths
2. ensure `uv` is available on `PATH`; if not, install it and verify `uv --version`
3. inspect or create `pyproject.toml` from `assets/pyproject-template.toml`
4. standardize Python commands around `uv run`
5. when a new dependency is required, add it with `uv add <package>`
6. if installation or dependency changes are blocked by sandbox or network policy, surface the exact command and request approval
7. inspect git state and confirm whether changes stay local or should also be pushed to a remote
8. if the repo already has a committed baseline on a stable branch, create a dedicated experiment branch before autotuning
9. initialize `results.tsv` if it does not already exist
10. scaffold missing files only after inspection and user confirmation
11. summarize the final experiment contract before running

Leave the repo with:

- resolved entrypoints
- a runnable baseline command
- a clear metric contract
- a clear batch-level stop condition
- a clear git plan
- a baseline result recorded before aggressive experimentation begins

## Scaffolding

When creating missing files:

- keep the first version small and easy to edit
- prefer the repo's existing libraries and conventions
- make training output end with a machine-readable summary block
- keep tunable knobs obvious
- keep the baseline deterministic enough for A/B comparison
- use `uv run` in commands and generated instructions

Use the bundled assets:

- `assets/prepare-template.py`
- `assets/train-template-generic.py`
- `assets/train-template-tabular.py`
- `assets/program-template.md`
- `assets/pyproject-template.toml`

If the user provides only data or a download script, synthesize the smallest justified baseline. Use the tabular template for CSV or dataframe-style tasks when it fits.

## Experiment Loop Contract

Default loop unless the user explicitly wants a different process:

- run the baseline first on a fresh experiment branch
- make one experiment-sized change at a time
- commit each experiment separately when git tracking is enabled
- redirect full output to `run.log`
- read the final metric block from `run.log`
- record every run in `results.tsv`
- keep improving changes and discard non-improving ones when the workflow supports it
- prefer simpler changes when gains are similar

### The agent IS the loop

Do not write batch automation scripts, meta-runners, or experiment harnesses that pre-generate configurations and run them all. The agent itself drives each iteration: edit the mutable file, run the command, read the result, decide what to try next. This is the core value of the loop — each experiment is informed by every previous result.

### Edit → Run → Commit/Revert cycle

Each experiment follows this exact sequence:

1. **Choose** the next experiment idea based on what has and has not worked so far
2. **Edit** the mutable file(s) (typically `train.py`) directly — the edit IS the experiment
3. **Run** the training command and redirect output to `run.log`
4. **Read** the final metric block from `run.log`
5. **Record** the result in `results.tsv`
6. **If improved**: commit the changed file(s) immediately with a descriptive message including the new metric
7. **If not improved**: revert the file(s) to the last committed state (`git checkout <file>`) before starting the next experiment

Never let a non-improving change persist in the working tree when starting the next experiment. The committed state of the mutable file should always reflect the current best.

### Adaptive experimentation

Do not pre-plan all experiments upfront. After every few runs, review what patterns are emerging:

- Which model families score highest?
- Which hyperparameter ranges are most promising?
- Which upsampling strategies help vs. hurt?
- Are there diminishing returns in the current direction?

Use these observations to focus subsequent experiments on the most promising region of the search space. Abandon directions that consistently underperform. Double down on directions that show gains.

Do not require a fixed per-run budget. Infer runtime expectations from the baseline or recent comparable successful runs, and use that to set hard timeouts.

If the final metric block is missing, inspect `run.log`, attempt an easy fix, and otherwise record a crash. If autonomous mode is requested, continue until interrupted or until the chosen batch-level stop rule is reached.

After a completed batch, run `scripts/summarize_results.py` on `results.tsv` to generate `results_summary.md` and `progress.svg`.

## Resources

- Read `references/defaults-and-scaffolding.md` for detailed heuristics, prompt wording, and template adaptation rules.
- Run `scripts/summarize_results.py` after completed experiment batches.
- Adapt the files in `assets/` instead of recreating common scaffolds from scratch.
