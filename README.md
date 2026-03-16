# Autotuning

This repository is intended to become a hub for agent skills related to machine learning, experimentation, and automated tuning workflows.

For now, it includes:

- the `agent-smith` skill in [`.agents/skills/agent-smith/`](/Users/yirending/code/autotuning/.agents/skills/agent-smith/SKILL.md)
- a small working demo project for tabular binary classification on the Kaggle insurance claims dataset

The longer-term goal is to grow this repository into a collection of reusable skills for different ML and experimentation tasks, while keeping concrete example projects here for testing and demos.

This work is inspired by [`autoresearch`](https://github.com/karpathy/autoresearch), adapted here toward more general experiment-loop scaffolding.

## Current Skill

`agent-smith` is the first bundled skill. It is designed to:

- scaffold or detect a `prepare.py`, `train.py`, and `program.md` workflow
- standardize Python package management around `uv`
- support experiment logging, branch-based iteration, and post-run summarization
- generalize across different problem types as long as the workflow produces a metric

## Current Demo Project

The current root-level demo is a tabular binary-classification setup:

- `prepare.py` handles stable data download and preprocessing
- `train.py` handles the mutable model and training baseline
- `program.md` defines the experiment rules for autonomous tuning

Current baseline:

- task: binary classification
- target: `claim_status`
- primary metric: validation AUC
- default workflow: keep the held-out validation split fixed across experiments

## Quick Start

1. Install dependencies with `uv sync`
2. Prepare the dataset with `uv run prepare.py`
3. Run the baseline with `uv run train.py`

## Notes

- Treat this repository as both a skill library and a sandbox for validating those skills.
- Keep local data, logs, caches, and transient experiment outputs out of git.
- Treat `program.md` as the operating guide for future experiment runs in the current demo project.
