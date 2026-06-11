# Agent Smith

Human-facing guide for prompting the `agent-smith` skill. Agent instructions live in [`SKILL.md`](SKILL.md).

Agent Smith turns a repository into a small, repeatable experimentation harness. It is designed for ML, data, and optimization workflows where an agent can edit a bounded experiment surface, run a command, read a metric, and keep or discard the change.

<p align="center">
  <img src="../../../data/agent_smith.png" alt="Agent Smith" width="260" />
</p>

## How To Prompt It

Use the skill when you want an agent to run or set up an experiment loop.

Examples:

- `Use Agent Smith to inspect this repo and prepare it for repeatable experiments.`
- `Use Agent Smith and run up to 100 experiments to improve the current model.`
- `Use Agent Smith to tune this training pipeline, keeping the validation split fixed.`
- `Use Agent Smith to scaffold prepare.py, train.py, and program.md for this dataset.`

## Workflow Contract

By default, Agent Smith expects or creates:

- `prepare.py` for stable data prep and evaluation utilities
- `train.py` for the mutable experiment surface
- `program.md` for operating instructions, metric contract, and guardrails
- `uv` for Python execution and dependency management
- `results.tsv` for append-only experiment tracking

The skill prefers the repository's existing structure over renaming files just to match those defaults. If the project uses R, the agent should pair Agent Smith with the [`r-docker`](../r-docker/SKILL.md) skill.

## Demo Project Quick Start

From the repository root:

```bash
uv sync
uv run prepare.py
uv run train.py
```

The root-level demo is a tabular binary-classification setup:

- task: binary classification
- target: `claim_status`
- primary metric: validation AUC
- default workflow: keep the held-out validation split fixed across experiments

## Example Agent Smith Run

This repository was used in a real Agent Smith experiment loop with the prompt:

> Use Agent Smith skill and run up to 100 experiments to improve the current model.

The run went like this:

1. Agent Smith inspected the repo, resolved `prepare.py`, `train.py`, and `program.md`, and inferred the metric contract as validation AUC with `higher` as better.
2. It kept the validation split fixed, created a dedicated experiment branch, verified `uv`, and ran the baseline model first.
3. The baseline logistic regression scored `0.625464` validation AUC.
4. A fast model-family scan showed HistGradientBoosting was materially stronger than the logistic baseline, so the search space shifted toward boosted trees.
5. The agent ran a reproducible 100-experiment batch: 90 single-model HistGradientBoosting candidates followed by 10 weighted blends of the best single runs.
6. The best blend was `hgb_rand_052@0.7 + hgb_rand_033@0.3`, which reached `0.669402` validation AUC.
7. `train.py` was updated to make that winning blend the default model, and the final verification run reproduced the same `0.669402` score.

That run improved validation AUC by `+0.043938` absolute over baseline while preserving the core Agent Smith contract:

- `prepare.py` stayed fixed
- `train.py` remained the mutable experiment surface
- all experiments used the same held-out split
- each run was judged by the same machine-readable summary block

<p align="center">
  <img src="../../../data/progress.svg" alt="Experiment progress" />
</p>

## Notes

- Treat `program.md` as the operating guide for future experiment runs in the current demo project.
- Keep local data, logs, caches, and transient experiment outputs out of git.
- The reusable skill logic lives in [`SKILL.md`](SKILL.md), [`references/`](references/), [`assets/`](assets/), and [`scripts/`](scripts/).