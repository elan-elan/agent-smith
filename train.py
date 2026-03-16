"""
Baseline binary classification training script for the insurance claims dataset.

Loads the prepared CSV, trains a tabular classifier, and reports validation AUC.
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier


PREPARED_DATA_PATH = Path("data/prepared/insurance_claims_prepared.csv")
TARGET_COLUMN = "claim_status"
PRIMARY_METRIC_NAME = "val_auc"
PRIMARY_METRIC_GOAL = "higher"
RUN_BUDGET_SECONDS = 300
RANDOM_SEED = 42
TEST_SIZE = 0.2
MAX_ITER = 2000
MIN_FREQUENCY = 20


def load_data() -> tuple[pd.DataFrame, pd.Series]:
    df = pd.read_csv(PREPARED_DATA_PATH)
    X = df.drop(columns=[TARGET_COLUMN], errors="ignore")
    y = df[TARGET_COLUMN].astype(int)
    return X, y


def build_model(X: pd.DataFrame, y: pd.Series) -> Pipeline:
    numeric_cols = X.select_dtypes(include=["number", "bool"]).columns.tolist()
    categorical_cols = [col for col in X.columns if col not in numeric_cols]

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median")),
                        ("scale", StandardScaler()),
                    ]
                ),
                numeric_cols,
            ),
            (
                "cat",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="most_frequent")),
                        (
                            "encode",
                            OneHotEncoder(
                                handle_unknown="ignore",
                                min_frequency=MIN_FREQUENCY,
                            ),
                        ),
                    ]
                ),
                categorical_cols,
            ),
        ],
        remainder="drop",
    )

    classifier = XGBClassifier(
        n_estimators=600,
        max_depth=3,
        learning_rate=0.03,
        subsample=0.7,
        colsample_bytree=0.8,
        min_child_weight=10,
        scale_pos_weight=0.5 * (y == 0).sum() / max((y == 1).sum(), 1),
        random_state=RANDOM_SEED,
        n_jobs=-1,
        eval_metric="auc",
    )

    return Pipeline(
        [
            ("preprocess", preprocessor),
            ("model", classifier),
        ]
    )


def main() -> None:
    t0 = time.time()
    X, y = load_data()
    X_train, X_val, y_train, y_val = train_test_split(
        X,
        y,
        test_size=TEST_SIZE,
        random_state=RANDOM_SEED,
        stratify=y,
    )

    model = build_model(X_train, y_train)

    fit_start = time.time()
    model.fit(X_train, y_train)
    fit_end = time.time()

    val_probs = model.predict_proba(X_val)[:, 1]
    primary_metric = roc_auc_score(y_val, val_probs)

    print("---")
    print(f"primary_metric:    {primary_metric:.6f}")
    print(f"metric_name:       {PRIMARY_METRIC_NAME}")
    print(f"metric_goal:       {PRIMARY_METRIC_GOAL}")
    print(f"training_seconds:  {fit_end - fit_start:.1f}")
    print(f"total_seconds:     {time.time() - t0:.1f}")
    print(f"train_rows:        {len(X_train)}")
    print(f"val_rows:          {len(X_val)}")
    print("status:            ok")


if __name__ == "__main__":
    main()
