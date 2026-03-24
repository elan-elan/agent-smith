# Defaults And Scaffolding

## Candidate path order

Use these as discovery hints, not rigid rules.

### Package metadata

Check for `pyproject.toml` at repo root first. If none exists, create it from `assets/pyproject-template.toml` before adding dependencies or standardizing `uv` commands.

### Prep candidates

Check in this order:

1. `prepare.py`
2. `scripts/prepare.py`
3. `src/**/prepare.py`
4. `download*.py`
5. `*kaggle*.py`
6. `data*.py`
7. `prep*.py`

If none exists and the user only has raw data, create `prepare.py` at repo root.

### Train candidates

Check in this order:

1. `train.py`
2. `scripts/train.py`
3. `src/**/train.py`
4. `fit.py`
5. `main.py`
6. `run_train.py`
7. `experiment*.py`

If none exists, create `train.py` at repo root.

### Program candidates

Check in this order:

1. `program.md`
2. `PROGRAM.md`
3. `prompts/program.md`
4. `docs/program.md`
5. `AGENTS.md` or `CLAUDE.md` only if they already contain repo-specific experiment instructions

If none exists, create `program.md` at repo root from `assets/program-template.md`.

## Minimum question set

Ask these first:

1. Which path should count as the prep script?
2. Which path should count as the training script?
3. Which path should count as the instructions file?
4. What metric should be optimized, is higher or lower better, and, if you have not already specified one, what single batch-level stop rule should I use: maximum experiments, maximum total wall-clock time, or early stop after N non-improving runs?
5. Should experiment tracking use local git only, or should commits also be pushed to a remote repository?

If any of the three core files are missing, also ask whether to create that file now.

Use prompts like:

- `I did not find a prep script. Would you like me to create a baseline prepare.py for you? If yes, tell me the data source, expected outputs, and any preprocessing constraints.`
- `I did not find a train script. Would you like me to create a baseline train.py for you? If yes, tell me the task type, model preference, target, and any hard hardware or dependency constraints.`
- `I did not find a program file. Would you like me to create a baseline program.md for you? If yes, tell me which files should be mutable, the run command, and the metric contract.`
- `If you want me to track or push experiment commits, give me the git remote or GitHub repository URL now. If not, I will assume local git tracking only.`
- `I see this repo is already committed to git. I recommend creating a separate experiment branch instead of committing autotuning runs to main. Should I create one now?`
- `I do not need a fixed per-run budget up front. If you have not already set one batch-level limit, give me one of these: maximum experiments, maximum total wall-clock time, or early stop after N non-improving runs.`

Ask follow-ups only when required:

- What task type is this: classification, regression, ranking, generation, fine-tuning, search, or other?
- Where does the prepared dataset live after prep finishes?
- Which column, field, or artifact is the prediction target?
- Which dependencies are already available and which are off-limits?
- What hardware should the baseline assume?

Also confirm:

- should all Python commands be normalized to `uv run`? default: yes
- if a dependency is missing, should the skill add it with `uv add` immediately? default: yes
- should git tracking remain local, or should the agent also push to a remote? default: local only unless the user gives a remote URL
- if the repo already has a committed baseline, should autotuning happen on a dedicated experiment branch? default: yes
- if the user has not already set one, which single batch-level stop rule should govern the run? default: ask for one; if the user does not care, prefer `max_experiments`

## Git workflow

If the repo is already under git:

- inspect the current branch and whether `HEAD` already has commits
- if the current branch is `main`, `master`, or another stable branch, default to creating a dedicated experiment branch before committing autotuning changes
- keep `main` as the stable baseline branch
- use branch names such as `agent-smith/<tag>` or `experiments/<tag>`
- only push experiment branches when the user wants remote tracking

If the repo is not under git yet, initialize it first if the user wants commit-based experiment tracking.

## Experiment loop defaults

### Per-experiment time budget

When scaffolding `program.md`, set `{{time_budget_minutes}}` based on problem complexity:

| Problem type | Default budget |
|---|---|
| Small tabular (<10 k rows, <50 features) | 2 minutes |
| Medium tabular (10 k–100 k rows) | 5 minutes |
| Large tabular (100 k–1 M rows) or text/NLP | 10 minutes |
| Image / deep learning / GPU workloads | 15–30 minutes |
| Large-scale or distributed training | 30–60 minutes |

These are starting defaults for scaffolded files. Once the baseline finishes, tighten the budget to **max(3× baseline wall-clock, 60 seconds)** for subsequent experiments. If the user supplies an explicit budget, always prefer that.

Use these defaults unless the user wants a different cadence:

- run the baseline first on a fresh branch before modifying code
- make one experiment-sized change per run
- the agent drives the loop directly — do not create batch runners, experiment scripts, or meta-harnesses that pre-generate and execute configurations; each iteration is an edit→run→evaluate→decide cycle performed by the agent
- each experiment is a direct edit to the mutable file (typically `train.py`), not a config passed to a generic runner
- after running, compare the result to the current best metric
- if the metric improved, commit the mutable file and `results.tsv` together immediately; the committed state should always reflect the current best
- if the metric did not improve, revert the mutable file to the last committed state before starting the next experiment (`git checkout <file>`) and commit `results.tsv` separately so the discard row is preserved
- infer per-run runtime expectations from the baseline or from recent comparable successful runs
- **always run experiment commands in a foreground (blocking) terminal** — never as a background process with periodic polling. Set the terminal timeout to the per-experiment time budget (in milliseconds). The agent blocks until the command finishes and automatically receives the output. This avoids wasting tokens on repeated `get_terminal_output` polling calls.
- redirect command output to `run.log` via `| tee run.log` so the agent gets live output from the blocking terminal AND a persistent log file for post-hoc inspection
- read the final summary block from `run.log` rather than streaming full output
- if the summary block is missing, inspect `tail -n 50 run.log`
- if the error is trivial, fix and rerun
- if the idea is broken or the run keeps crashing, log `crash` and move on
- enforce the per-experiment time budget from `program.md`; set the terminal timeout to the budget in milliseconds; after the baseline, tighten the budget to max(3× baseline wall-clock, 60 seconds)
- stop the batch when the chosen batch-level rule is reached

### Recording, hygiene, and adaptive strategy

The rules for incremental `results.tsv` recording, working tree hygiene, adaptive decision-making, and the `results.tsv` format are defined in the SKILL.md Hard Rules and Experiment Loop sections. They are the canonical source — do not duplicate them here.

Key additional defaults for this reference:

- Initialize `results.tsv` with just the header row before the first baseline run
- After appending a row, sanity-check with `tail -1 results.tsv`
- If the file gets out of sync, fix it immediately with a single `printf` append before continuing

## Post-run summarization

After a completed run batch, or when the user asks for a recap, run the bundled summary script against `results.tsv`.

If the skill is stored inside the repo at `.agents/skills/agent-smith`, prefer:

```bash
uv run python .agents/skills/agent-smith/scripts/summarize_results.py results.tsv --goal higher
```

Adjust `--goal` to `lower` when lower metrics are better. The script will generate:

- `results_summary.md`
- `progress.svg`

The script auto-detects common metric columns such as `primary_metric`, `metric`, and `val_bpb`.

## Package management

**`uv` is the only permitted package manager.** Mixing package managers causes lock file conflicts and phantom dependency mismatches that break reproducibility. All Python execution must use `uv run` and all dependency additions must use `uv add`.

- check `which uv` first
- if `uv` is missing, install it before any `uv run` or `uv add` step rather than falling back to `pip` or `conda`
- prefer a persistent base-shell install, e.g. `~/.local/bin`, instead of a conda-only install
- make sure the shell startup file used by non-interactive shells exposes that path, then verify with `which uv` and `uv --version`
- run scripts as `uv run prepare.py`, `uv run train.py`, or `uv run python path/to/script.py`
- create `pyproject.toml` from `assets/pyproject-template.toml` if missing
- when a new dependency is required, run `uv add <package>` and let that update `pyproject.toml`
- avoid manually editing dependency lines unless the `uv add` command is not possible
- if custom indexes are needed, add the matching `[tool.uv.sources]` and `[[tool.uv.index]]` entries after the dependency is introduced

Default install flow when `uv` is missing:

1. install `uv` with the official installer
2. place it in a persistent user path such as `~/.local/bin`
3. add that path to the shell startup file that future non-interactive shells will read
4. verify `which uv` and `uv --version`
5. only then continue with `uv add` or `uv run`

## Scaffolding `prepare.py`

Keep `prepare.py` thin and reproducible:

- download or locate raw data
- perform stable preprocessing only
- write prepared artifacts to predictable paths
- keep evaluation constants and immutable utilities here if that matches the repo
- do not mix experiment search logic into this file

If a Kaggle or shell download script already exists, wrap or reuse it instead of duplicating the logic.

If the user wants a new prep file from scratch, start from `assets/prepare-template.py`.

## Scaffolding `train.py`

Prefer the project's current stack:

1. existing project training code
2. existing project ML libraries
3. lightweight libraries already declared in the repo
4. only then a new minimal baseline, if the user approves new dependencies

For a CSV or tabular task:

- inspect the columns first
- infer or ask whether the target is categorical or continuous
- create a deterministic train/validation split
- place model and optimization knobs near the top
- print a final metric block the agent can grep later

If `pandas` and `scikit-learn` are already available, adapt `assets/train-template-tabular.py` instead of rewriting the whole baseline from scratch.

Otherwise, start from `assets/train-template-generic.py` and replace the placeholder functions with the simplest repo-specific baseline that fits the user's description.

Make the script easy to iterate on:

- one file if possible
- low ceremony
- obvious hyperparameters
- minimal hidden state

## Final summary block

Prefer a machine-readable block like:

```text
---
primary_metric:    0.123456
metric_name:       val_loss
metric_goal:       lower
training_seconds:  300.0
total_seconds:     318.4
status:            ok
```

Add extra fields only when they are useful and stable.

## `program.md` adaptation

When generating `program.md` from the template:

- fill in resolved paths, not placeholders
- name the mutable file or files explicitly
- name the fixed evaluation contract explicitly
- state the exact `uv run ...` command
- state the chosen batch-level stop rule explicitly
- state the keep/discard rule in terms of the chosen metric
- if Agent Smith generated the file, tell the user to customize it before long autonomous runs
- include git branch and remote expectations when the user has provided them
- tell the user that autotuning should happen on a separate branch when the repo already has a stable committed baseline
- add baseline-first, timeout, crash-handling, and `run.log` rules unless the user has a better existing workflow
- include a post-run summary step that runs `scripts/summarize_results.py` on `results.tsv`

Keep the first version concise. It is an operating guide, not full documentation.
