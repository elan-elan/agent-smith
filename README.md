# Agent Smith Demo Repository

This repository is a small tabular-model experimentation setup for the Kaggle insurance claims dataset. It is designed to work with the Agent Smith skill and follow a simple three-file workflow:

- `prepare.py` handles stable data download and preprocessing
- `train.py` handles the mutable model and training baseline
- `program.md` defines the experiment rules for later autonomous runs

This repository is inspired by [`autoresearch`](https://github.com/karpathy/autoresearch), adapted here for a tabular binary-classification workflow.

## Quick Start

1. Install dependencies with `uv sync`
2. Prepare the dataset with `uv run prepare.py`
3. Run the baseline with `uv run train.py`

## Current Baseline

- task: binary classification
- target: `claim_status`
- primary metric: validation AUC
- default workflow: keep the held-out validation split fixed across experiments

## Repository Notes

- Use the Agent Smith skill in `.agents/skills/agent-smith/` to scaffold or refine similar experiment loops.
- Keep local data, logs, caches, and transient experiment outputs out of git.
- Treat `program.md` as the operating guide for future experiment runs.
