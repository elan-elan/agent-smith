"""
Baseline tabular CSV training template.

Use this only when the repo already has pandas + scikit-learn available,
or after the user approves adding them. Replace the placeholder constants
before running.
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, mean_squared_error
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

# Fill these in for the specific repo.
DATA_PATH = Path("{{data_path}}")
TARGET_COLUMN = "{{target_column}}"
TASK_TYPE = "{{task_type}}"  # classification | regression
RANDOM_SEED = 42
TEST_SIZE = 0.2
N_ESTIMATORS = 300
MAX_DEPTH = None


def build_model():
    if TASK_TYPE == "classification":
        return RandomForestClassifier(
            n_estimators=N_ESTIMATORS,
            max_depth=MAX_DEPTH,
            random_state=RANDOM_SEED,
            n_jobs=-1,
        )
    if TASK_TYPE == "regression":
        return RandomForestRegressor(
            n_estimators=N_ESTIMATORS,
            max_depth=MAX_DEPTH,
            random_state=RANDOM_SEED,
            n_jobs=-1,
        )
    raise ValueError(f"Unsupported TASK_TYPE: {TASK_TYPE}")


def main():
    t0 = time.time()

    df = pd.read_csv(DATA_PATH)
    if TARGET_COLUMN not in df.columns:
        raise KeyError(f"Missing target column: {TARGET_COLUMN}")

    X = df.drop(columns=[TARGET_COLUMN])
    y = df[TARGET_COLUMN]

    numeric_cols = X.select_dtypes(include=["number", "bool"]).columns.tolist()
    categorical_cols = [c for c in X.columns if c not in numeric_cols]

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline([("impute", SimpleImputer(strategy="median"))]),
                numeric_cols,
            ),
            (
                "cat",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="most_frequent")),
                        ("encode", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_cols,
            ),
        ],
        remainder="drop",
    )

    model = Pipeline(
        [
            ("preprocess", preprocessor),
            ("model", build_model()),
        ]
    )

    X_train, X_val, y_train, y_val = train_test_split(
        X,
        y,
        test_size=TEST_SIZE,
        random_state=RANDOM_SEED,
        stratify=y if TASK_TYPE == "classification" else None,
    )

    fit_start = time.time()
    model.fit(X_train, y_train)
    fit_end = time.time()

    preds = model.predict(X_val)
    if TASK_TYPE == "classification":
        metric_name = "val_accuracy"
        metric_goal = "higher"
        primary_metric = accuracy_score(y_val, preds)
    else:
        metric_name = "val_rmse"
        metric_goal = "lower"
        primary_metric = mean_squared_error(y_val, preds, squared=False)

    print("---")
    print(f"primary_metric:    {primary_metric:.6f}")
    print(f"metric_name:       {metric_name}")
    print(f"metric_goal:       {metric_goal}")
    print(f"training_seconds:  {fit_end - fit_start:.1f}")
    print(f"total_seconds:     {time.time() - t0:.1f}")
    print("status:            ok")


if __name__ == "__main__":
    main()
