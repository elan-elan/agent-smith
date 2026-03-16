# Experiment Program

If Agent Smith generated this file for you, treat it as a baseline. Edit it to add repo-specific instructions, branch conventions, experiment preferences, and any other workflow rules you want enforced before long autonomous runs.

This repository uses an Agent Smith experiment loop for `{{project_goal}}`.

## Setup

To set up a new run, work with the user to:

1. agree on a run tag or branch name
2. resolve the core paths:
   - prep: `{{prepare_path}}`
   - train: `{{train_path}}`
   - instructions: `{{program_path}}`
3. verify that `uv` is installed and available on `PATH`; if not, install it first
4. inspect the git state and confirm whether changes stay local or should also be pushed to a remote repository
5. read the in-scope files for full context
6. verify that prepared data exists or that the prep command is runnable
7. verify that Python commands are run with `uv run`
8. initialize a simple experiment log such as `results.tsv` if the repo does not already have one
9. confirm the baseline command and metric contract

## Experimentation

Each experiment should optimize `{{metric_name}}`, where `{{metric_goal}}` is better.

Default run command:

```bash
{{train_command}}
```

Default budget per run: `{{time_budget}}`

If a new Python dependency is required during experimentation, add it with `uv add <package>` so `pyproject.toml` stays in sync.

### Mutable surface

By default, modify:

- `{{mutable_paths}}`

Avoid modifying:

- `{{fixed_paths}}`

unless the user explicitly broadens the search space.

## Logging

Record experiments in a simple tab-separated file when helpful:

```text
commit	metric	status	description
```

Use `keep`, `discard`, or `crash` for status unless the repo already has a different convention.

## Loop

Repeat:

1. inspect the current repo state
2. make one experiment-sized change
3. run the training command
4. read the final metric block
5. record the result
6. keep or discard the change based on whether it improved `{{metric_name}}`

## Guardrails

- prefer small, reviewable diffs
- keep the baseline runnable at all times
- avoid dependency churn unless the user approves it
- when a dependency is required, prefer `uv add` over manual dependency edits
- prefer simpler changes when gains are similar
