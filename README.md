# Agent Smith Skills

This repository is a small skill library plus a sandbox for validating agent workflows. It currently focuses on reusable skills for experimentation, data workflows, and deterministic browser automation.

## Skills

### Agent Smith

[`agent-smith`](.agents/skills/agent-smith/README.md) turns a repository into a repeatable experiment harness. It helps agents inspect or scaffold a `prepare.py`, `train.py`, and `program.md` workflow, run metric-driven experiments, and keep or discard changes through a git-safe loop.

The root-level insurance claims demo is the current testbed for this skill. See the [Agent Smith README](.agents/skills/agent-smith/README.md) for prompt examples, workflow details, and the recorded experiment run.

### R-Docker

[`r-docker`](.agents/skills/r-docker/SKILL.md) runs R models and visualizations through Docker without requiring a local R installation. It supports one-off R execution, persistent experiment-loop containers, common CRAN model families, and integration with Agent Smith-style tuning.

### Google Earth Crop

[`google-earth-crop`](.agents/skills/google-earth-crop/README.md) captures Google Earth Web crops with Playwright, including historical imagery before a cutoff date. It defaults to centered square neighborhood crops, overlays a red dot at the queried location, writes a JSON sidecar, and includes a 10-location benchmark/eval.

Example prompts:

- `Use the google-earth-crop skill to get an image for "1150 Amsterdam Ave, New York, NY 10027" before 2025-01-01.`
- `Use google-earth-crop to capture "45.6273,-122.6716" before 2020-01-01 and save it under crops/vancouver-wa/.`
- `Run the google-earth-crop benchmark/eval.`

## Install Skills With SkillKit

[SkillKit](https://www.skillkit.sh/docs) installs, translates, and syncs skills across AI coding agents. From this repository, you can install the local skill collection or an individual skill.

No global install:

```bash
npx skillkit@latest init
npx skillkit@latest install ./.agents/skills
npx skillkit@latest sync
```

Frequent use:

```bash
npm install -g skillkit
skillkit init
skillkit install ./.agents/skills
skillkit sync
```

To install just one skill, replace `./.agents/skills` with a skill directory such as `./.agents/skills/google-earth-crop`.

## Demo Project

The repository root includes a compact tabular binary-classification demo on insurance claims data:

- [`prepare.py`](prepare.py) prepares the dataset
- [`train.py`](train.py) trains and reports the baseline metric
- [`program.md`](program.md) defines the experiment rules for Agent Smith

This demo exists to exercise the skills in a concrete project. Local data, logs, caches, and transient experiment outputs should stay out of git.
