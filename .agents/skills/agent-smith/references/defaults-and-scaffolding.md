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

Use these defaults unless the user wants a different cadence:

- run the baseline first on a fresh branch before modifying code
- make one experiment-sized change per run
- the agent drives the loop directly — do not create batch runners, experiment scripts, or meta-harnesses that pre-generate and execute configurations; each iteration is an edit→run→evaluate→decide cycle performed by the agent
- each experiment is a direct edit to the mutable file (typically `train.py`), not a config passed to a generic runner
- after running, compare the result to the current best metric
- if the metric improved, commit the mutable file and `results.tsv` together immediately; the committed state should always reflect the current best
- if the metric did not improve, revert the mutable file to the last committed state before starting the next experiment (`git checkout <file>`) and commit `results.tsv` separately so the discard row is preserved
- infer per-run runtime expectations from the baseline or from recent comparable successful runs
- redirect command output to `run.log`
- read the final summary block from `run.log` rather than streaming full output
- if the summary block is missing, inspect `tail -n 50 run.log`
- if the error is trivial, fix and rerun
- if the idea is broken or the run keeps crashing, log `crash` and move on
- use a hard timeout of roughly 2x the baseline run time or the last comparable successful run
- stop the batch when the chosen batch-level rule is reached

### Incremental `results.tsv` recording

**Hard rule.** Append one row to `results.tsv` immediately after reading each experiment's result — before committing, reverting, or planning the next experiment. Never defer recording to the end of a batch.

Use a single `printf` line to append:

```bash
printf '%s\t%s\t%s\t%s\n' "<N>" "<metric>" "<status>" "<description>" >> results.tsv
```

**Prohibited**: bulk-appending multiple rows at once, heredocs (`<< EOF`) with many lines, or reconstructing results from memory after the fact. Large heredocs can corrupt the terminal session. Reconstructing from memory risks data loss.

After appending, sanity-check: `tail -1 results.tsv`

If the file gets out of sync, fix it immediately with a single `printf` append before continuing.

### Working tree hygiene

- **No throwaway scripts**: do not create temporary utility scripts (e.g., `check_importances.py`) in the repo during the loop. Use inline terminal commands (`python -c '...'`) for one-off analysis.
- **No large terminal operations**: avoid heredocs with dozens of lines or long `echo` chains. These corrupt the terminal session. Keep commands short and atomic.
- **Clean tree between experiments**: before each experiment, the working tree should contain only committed files plus at most an uncommitted `results.tsv` update. Run `git status` periodically to verify.

### Adaptive decision-making

Do not plan all experiments in advance. After each run (or every few runs), reflect on the results so far:

- which model families or architectures scored highest?
- which hyperparameter directions are trending better?
- which strategies (e.g., upsampling methods, regularization) helped vs. hurt?
- are there diminishing returns — should the agent switch to a different approach?

Use these patterns to choose the next experiment. Favor exploitation of promising directions while periodically exploring new ones. This informed iteration is the primary advantage of agent-driven experimentation over grid search.

**Pruning heuristic**: when a new model family or major direction scores substantially worse than the current best (e.g., >1.5% absolute metric gap), do not invest additional experiments tuning it. One or two probes are enough to establish that a direction is unpromising. Move on.

Prefer a simple tab-separated experiment log:

```text
experiment	<metric_column>	status	description
```

- **experiment**: sequential integer starting at 1
- **metric column**: matches the metric name from the training output (e.g., `val_auc`, `val_loss`, `primary_metric`)
- **status**: one of `keep`, `discard`, or `crash` (the bundled `summarize_results.py` depends on these exact values)

Initialize `results.tsv` with just the header row before the first baseline run. Commit `results.tsv` as part of the post-batch wrap-up.

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

Use `uv` for Python execution and dependency changes.

- check `which uv` first
- if `uv` is missing, install it before any `uv run` or `uv add` step
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
