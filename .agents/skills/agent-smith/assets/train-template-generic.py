"""
Baseline train.py template for Agent Smith repos.

Adapt this when the user does not already have a training script and the task
is not specific enough for a more specialized template.
"""

from __future__ import annotations

import time
from pathlib import Path


PREPARED_DATA_PATH = Path("{{prepared_data_path}}")
PRIMARY_METRIC_NAME = "{{primary_metric_name}}"
PRIMARY_METRIC_GOAL = "{{primary_metric_goal}}"  # higher | lower
RUN_BUDGET_SECONDS = 300  # replace with the user-specific budget
RANDOM_SEED = 42


def load_data():
    """Return the prepared data object(s) needed for training and validation."""
    raise NotImplementedError("Implement repo-specific data loading.")


def build_model():
    """Return the baseline model or training object."""
    raise NotImplementedError("Implement model construction.")


def train_model(model, data):
    """Fit the model and return any training state needed for evaluation."""
    raise NotImplementedError("Implement training.")


def evaluate_model(model, data):
    """Return the primary metric as a float."""
    raise NotImplementedError("Implement evaluation.")


def main():
    t0 = time.time()
    data = load_data()
    model = build_model()

    fit_start = time.time()
    train_model(model, data)
    fit_end = time.time()

    primary_metric = evaluate_model(model, data)

    print("---")
    print(f"primary_metric:    {primary_metric:.6f}")
    print(f"metric_name:       {PRIMARY_METRIC_NAME}")
    print(f"metric_goal:       {PRIMARY_METRIC_GOAL}")
    print(f"training_seconds:  {fit_end - fit_start:.1f}")
    print(f"total_seconds:     {time.time() - t0:.1f}")
    print("status:            ok")


if __name__ == "__main__":
    main()
