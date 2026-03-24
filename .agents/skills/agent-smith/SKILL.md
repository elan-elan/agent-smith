---
name: agent-smith
description: Create or adapt lightweight experiment harnesses for machine learning, data, and iterative optimization repos. Use when the agent needs to inspect or scaffold a `prepare.py` / `train.py` / `program.md` style workflow, standardize Python execution with `uv`, set up git-safe experimentation, and run repeatable keep-or-discard experiment loops with logged results. Make sure to use this skill whenever the user mentions experiment loops, hyperparameter tuning, autotuning, ML iteration, train/eval cycles, setting up reproducible experiments, or wants to systematically optimize a model — even if they don't explicitly say "agent smith".
---

# Agent Smith

Turn a repo into a small, repeatable experimentation harness.

Default contract:

- `prepare.py` for stable data prep and evaluation utilities
- `train.py` for the main mutable experiment surface
- `program.md` for the agent operating instructions
- `uv` for Python execution and dependency management

Prefer the repo's existing structure over renaming files just to match the default names.

## Non-Python Runtimes

The experiment loop is not limited to Python. The same edit → run → commit/revert cycle and `results.tsv` tracking apply regardless of language.

- **R models**: use the **r-docker** skill. Read its `SKILL.md` and `references/r-model-cookbook.md` before writing any R code.

## Setup

Read [references/defaults-and-scaffolding.md](./references/defaults-and-scaffolding.md) before proposing defaults. It contains candidate path order, intake prompts, scaffold heuristics, git workflow, and `program.md` adaptation rules.

**Intake**: Inspect the repo, infer defaults, then confirm in one short message: prep entrypoint, training entrypoint, instructions file, metric contract, batch-level stop rule, and git tracking preference. See the reference for exact prompts and follow-up questions.

**Setup checklist**: resolve paths → for each of the three core files (`prepare.py`, `train.py`, `program.md` or their resolved equivalents): if it exists, **read it**; if it does not exist, **scaffold it** from `assets/` templates adapted to the user's prompt, then read it → ensure `uv` → inspect/create `pyproject.toml` → **create experiment branch** (if on `main`/`master`, branch to `experiments/<tag>` before any commits) → initialize `results.tsv` → **present program.md for review** (see below) → summarize the experiment contract.

**Scaffolding**: use the bundled `assets/` templates. Keep files small, prefer existing libraries, make output end with a machine-readable summary block.

### Pre-loop `program.md` review

Before starting any experiments, present a concise summary of `program.md` to the user — highlight the metric contract, mutable surface, stop rules, and any domain-specific guardrails. Then ask:

> Here is a quick summary of the current experiment program. Is there anything you would like to change about the default behavior before we start?

Wait for the user's response. If they provide changes or additional context, update `program.md` immediately before entering the experiment loop.

## `program.md` as a Living Document

`program.md` is the single source of truth for experiment behavior. Treat it as a living document throughout the run:

- **Add user feedback**: Whenever the user provides additional information, preferences, constraints, or clarifications during the run, append or update the relevant section of `program.md` so the guidance is preserved for future iterations.
- **Consult when unsure**: When the agent is uncertain about strategy, scope, metric interpretation, or any experiment decision, re-read `program.md` before proceeding. The answer may already be there.
- **Respect mid-run edits**: The user may manually edit `program.md` at any time during the run. Before each experiment, if significant iterations have passed or the agent is making a strategic decision, re-read `program.md` to pick up any changes the user may have made.

## Experiment Loop

### The agent IS the loop

The agent itself drives each iteration: edit, run, read, decide. Each experiment is informed by every previous result — the agent can change direction based on what worked and what didn't, which is impossible with pre-planned batch scripts. For this reason, do not write batch automation scripts, meta-runners, or experiment harnesses; they lock in decisions before results are known and defeat the adaptive advantage.

### Edit → Run → Record → Commit/Revert

Each experiment follows this exact sequence:

1. **Edit** the mutable file — the code change IS the experiment
2. **Run** the training command in a **foreground (blocking) terminal** (see Terminal Execution below): `uv run train.py 2>&1 | tee run.log`
3. **Enforce the time budget** — set the terminal timeout to the per-experiment time budget from `program.md` (in milliseconds). If the run exceeds it, the terminal returns automatically; treat the run as a `crash` (with a timeout note), revert, and move on
4. **Read** the final metric block from `run.log`
5. **Commit or revert first** to capture the commit hash:
   - **If improved**: `git add <mutable> && git commit -m "exp N: <description>"`, then capture `COMMIT=$(git rev-parse --short HEAD)`
   - **If not improved (or crash)**: `git checkout -- <mutable>`, set `COMMIT=""`
6. **Record** the result in `results.tsv` — **immediately** after the commit/revert, using `$COMMIT` (see Hard Rules §1). Never skip this step, even for crashes or nonsensical outputs.
7. **Commit `results.tsv`**: `git add results.tsv && git commit -m "results: exp N (keep|discard|crash)"`

The committed mutable file should always reflect the current best.

### `results.tsv` format

```text
experiment	<metric_column>	status	commit	description
```

- **experiment**: sequential integer starting at 1
- **status**: one of `keep`, `discard`, or `crash` (the bundled `summarize_results.py` depends on these exact values)
- **commit**: short git hash from the code commit (`git rev-parse --short HEAD`); empty for `discard` and `crash` since their code is never committed
- Leave the metric cell empty for crash/invalid runs

### Adaptive experimentation

Do not pre-plan all experiments. After every few runs, review emerging patterns and focus on the most promising directions. Abandon directions that consistently underperform.

**Pruning heuristic**: when a new direction scores >1.5% absolute worse than current best, one or two probes is enough — move on.

### Complexity-aware stopping

As the batch progresses, track the complexity of each experiment alongside its metric. When the last 3–5 experiments each yield smaller gains than the early ones, the curve is plateauing. At that point, stop chasing marginal improvements through added complexity (stacking, heavy feature engineering, large grids). A solution within ~0.1–0.3% of the best that is dramatically simpler is often the better outcome. Note trade-off reasoning in `results.tsv` descriptions so it's preserved.

See [references/defaults-and-scaffolding.md](./references/defaults-and-scaffolding.md) for full adaptive decision-making guidance.

### Terminal execution

Always run experiment commands in a **foreground (blocking) terminal** — never as a background process with periodic polling. This is critical for token efficiency:

- **Foreground terminal**: the tool call blocks until the command finishes. The agent automatically receives the output and knows the run is complete. No polling needed.
- **Timeout**: set the terminal timeout to the per-experiment time budget from `program.md`, converted to milliseconds (e.g., 300 s → `300000` ms). If the command exceeds this, the terminal returns with whatever output was collected — treat it as a `crash`.
- **Never use background terminals** for experiment runs. Background execution requires the agent to repeatedly call `get_terminal_output` to check if the run finished, wasting tokens on every poll.
- **`| tee run.log`** still applies — the output goes to both the terminal (which the agent reads on completion) and `run.log` (which is useful for post-hoc inspection and `grep`).

## Hard Rules

Violating these has caused real data-loss and workflow failures:

### 1. Record `results.tsv` immediately after each experiment

Every experiment gets exactly one row — successes, failures, crashes, timeouts, nonsensical results. A missing row is always worse than a `crash` row, because it silently breaks the sequential numbering and makes the history unrecoverable.

Column order: `experiment  metric  status  commit  description`. Always use positional `printf`:

```bash
printf '%s\t%s\t%s\t%s\t%s\n' "<N>" "<metric>" "<status>" "$COMMIT" "<description>" >> results.tsv
```

After every append, validate the row:

```bash
tail -1 results.tsv | awk -F'\t' '{ if ($1!~/^[0-9]+$/ || $2!~/^[0-9.eE+-]*$/ || $3!~/^(keep|discard|crash)$/ || $4!~/^[0-9a-f]*$/) print "ERROR: "$0; else print "OK: "$0 }'
```

If `ERROR`, delete the bad row and re-append correctly. Common mistake: swapping the metric (col 2) and description (col 5).

Every 5 experiments, check for gaps: `awk -F'\t' 'NR>1 && $1!=NR-1 { print "GAP: expected "NR-1" got "$1 }' results.tsv`. Fix gaps before continuing.

Bulk-appending multiple rows or reconstructing from memory has caused real data loss in past runs — always append one row at a time, immediately after the experiment finishes.

### 2. Keep the working tree clean

- **No throwaway scripts** in the repo. Use `python -c '...'` for one-off analysis.
- **No large terminal operations** (multi-line heredocs, long echo chains). Keep commands short and atomic.
- **Verify periodically**: `git status` should show only committed files + at most an uncommitted `results.tsv` update.

### 3. All files stay inside the repository

All files — log files (`run.log`), results (`results.tsv`), intermediate outputs, and any other artifacts — must live in the repo working tree. Writing to `/tmp`, `/var`, or the home directory can silently fail due to permissions and makes experiments unreproducible, since those paths aren't tracked by git and won't survive across machines or sessions.

### 4. `uv` is the only package manager

Mixing package managers causes lock file conflicts, phantom dependency mismatches, and breaks reproducibility — an experiment that works under `pip` but not `uv` (or vice versa) is undebuggable. All Python execution must go through `uv run` and all dependency additions through `uv add`. If `uv` is not installed, install it first rather than falling back to another tool.

### 5. Revert before starting the next experiment

A non-improving change must be reverted before the next experiment begins. If stale code remains in the working tree, the next experiment builds on the wrong baseline, making its metric incomparable to previous results and corrupting the entire experiment history.

## Post-Batch Wrap-Up

Perform these steps **automatically** when the batch is complete:

1. **Verify best state**: rerun training on committed code to confirm the metric is reproducible
2. **Verify `results.tsv` integrity**: `wc -l results.tsv` should equal N + 1 (header + experiments)
3. **Run the summary script**:
   ```bash
   uv run python .agents/skills/agent-smith/scripts/summarize_results.py results.tsv
   ```
   Adjust `--goal lower` when lower metrics are better.
4. **Commit artifacts**: `git add -f results.tsv results_summary.md progress.svg && git commit -m "..."`
5. **Clean up**: remove any stray files, verify with `git status`
6. **Report**: total experiments, kept/discarded/crash counts, baseline → best metric, improvement

## Resources

- [references/defaults-and-scaffolding.md](./references/defaults-and-scaffolding.md) — detailed heuristics, prompts, template adaptation rules, git workflow, experiment loop defaults
- `scripts/summarize_results.py` — generates `results_summary.md` and `progress.svg` from `results.tsv`
- `assets/` — templates for `prepare.py`, `train.py`, `program.md`, `pyproject.toml`
- `assets/feature-importances-template.py` — inspect feature importances from an sklearn ColumnTransformer + tree model pipeline; run directly instead of creating throwaway scripts
