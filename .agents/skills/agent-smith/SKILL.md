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

**Setup checklist**: resolve paths → for each of the three core files (`prepare.py`, `train.py`, `program.md` or their resolved equivalents): if it exists, **read it**; if it does not exist, **scaffold it** from `assets/` templates adapted to the user's prompt, then read it → ensure `uv` → inspect/create `pyproject.toml` → **create experiment branch** (if on `main`/`master`, branch to `experiments/<tag>` before any commits) → initialize `results.tsv` → summarize the experiment contract.

**Scaffolding**: use the bundled `assets/` templates. Keep files small, prefer existing libraries, make output end with a machine-readable summary block.

## Experiment Loop

### The agent IS the loop

Do not write batch automation scripts, meta-runners, or experiment harnesses. The agent itself drives each iteration: edit, run, read, decide. Each experiment is informed by every previous result.

### Edit → Run → Record → Commit/Revert

Each experiment follows this exact sequence:

1. **Edit** the mutable file — the code change IS the experiment
2. **Run** the training command: `uv run train.py 2>&1 | tee run.log`
3. **Enforce the time budget** — if the run exceeds the per-experiment limit from `program.md`, kill it, record `crash` (with a timeout note), revert, and move on
4. **Read** the final metric block from `run.log`
5. **Record** the result in `results.tsv` — **immediately** (see Hard Rules §1 below)
6. **If improved**: commit the mutable file(s) and `results.tsv` together
7. **If not improved**: revert the mutable file(s) (`git checkout <file>`) and commit `results.tsv` separately so the discard row is preserved

The committed mutable file should always reflect the current best.

### `results.tsv` format

```text
experiment	<metric_column>	status	description
```

- **experiment**: sequential integer starting at 1
- **status**: one of `keep`, `discard`, or `crash` (the bundled `summarize_results.py` depends on these exact values)
- Leave the metric cell empty for crash/invalid runs

### Adaptive experimentation

Do not pre-plan all experiments. After every few runs, review emerging patterns and focus on the most promising directions. Abandon directions that consistently underperform.

**Pruning heuristic**: when a new direction scores >1.5% absolute worse than current best, one or two probes is enough — move on.

See [references/defaults-and-scaffolding.md](./references/defaults-and-scaffolding.md) for full adaptive decision-making guidance.

## Hard Rules

These rules exist because violating them caused real data-loss and workflow failures:

### 1. Record `results.tsv` immediately after each experiment

Append one row via `printf` right after reading the result — before committing, reverting, or planning the next experiment.

```bash
printf '%s\t%s\t%s\t%s\n' "<N>" "<metric>" "<status>" "<description>" >> results.tsv
tail -1 results.tsv   # sanity check
```

Bulk-appending multiple rows, heredocs with many lines, and reconstructing results from memory have all caused real data loss — avoid them.

### 2. Keep the working tree clean

- **No throwaway scripts** in the repo. Use `python -c '...'` for one-off analysis.
- **No large terminal operations** (multi-line heredocs, long echo chains). Keep commands short and atomic.
- **Verify periodically**: `git status` should show only committed files + at most an uncommitted `results.tsv` update.

### 3. Never start an experiment with stale state

A non-improving change must be reverted before the next experiment begins.

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
