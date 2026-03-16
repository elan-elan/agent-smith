"""
Training script for the insurance claims dataset.

Uses a fixed train/validation split, shared ordinal preprocessing, and a
weighted HistGradientBoosting ensemble tuned for validation AUC.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder


PREPARED_DATA_PATH = Path("data/prepared/insurance_claims_prepared.csv")
TARGET_COLUMN = "claim_status"
PRIMARY_METRIC_NAME = "val_auc"
PRIMARY_METRIC_GOAL = "higher"
RUN_BUDGET_SECONDS = 300
RANDOM_SEED = 42
TEST_SIZE = 0.2


@dataclass(frozen=True)
class HGBSpec:
    name: str
    weight: float
    max_iter: int
    learning_rate: float
    max_leaf_nodes: int = 31
    min_samples_leaf: int = 20
    l2_regularization: float = 0.0
    max_features: float = 1.0
    max_bins: int = 255
    validation_fraction: float = 0.1
    n_iter_no_change: int = 10
    tol: float = 1e-7


DEFAULT_ENSEMBLE = (
    HGBSpec(
        name="hgb_high_lr_smooth",
        weight=0.7,
        max_iter=700,
        learning_rate=0.08,
        max_leaf_nodes=15,
        min_samples_leaf=30,
        l2_regularization=1.0,
        max_features=0.7,
        max_bins=255,
        validation_fraction=0.2,
        n_iter_no_change=10,
        tol=1e-6,
    ),
    HGBSpec(
        name="hgb_compact_high_lr",
        weight=0.3,
        max_iter=150,
        learning_rate=0.1,
        max_leaf_nodes=15,
        min_samples_leaf=5,
        l2_regularization=1.0,
        max_features=0.5,
        max_bins=64,
        validation_fraction=0.1,
        n_iter_no_change=30,
    ),
)


def load_data() -> tuple[pd.DataFrame, pd.Series]:
    df = pd.read_csv(PREPARED_DATA_PATH)
    X = df.drop(columns=[TARGET_COLUMN], errors="ignore")
    y = df[TARGET_COLUMN].astype(int)
    return X, y


def split_data(
    X: pd.DataFrame,
    y: pd.Series,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
    return train_test_split(
        X,
        y,
        test_size=TEST_SIZE,
        random_state=RANDOM_SEED,
        stratify=y,
    )


def build_preprocessor(X: pd.DataFrame) -> ColumnTransformer:
    numeric_cols = X.select_dtypes(include=["number", "bool"]).columns.tolist()
    categorical_cols = [col for col in X.columns if col not in numeric_cols]

    return ColumnTransformer(
        transformers=[
            (
                "num",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median")),
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
                            OrdinalEncoder(
                                handle_unknown="use_encoded_value",
                                unknown_value=-1,
                                encoded_missing_value=-1,
                            ),
                        ),
                    ]
                ),
                categorical_cols,
            ),
        ],
        remainder="drop",
        sparse_threshold=0.0,
    )


def transform_splits(
    X_train: pd.DataFrame,
    X_val: pd.DataFrame,
) -> tuple[ColumnTransformer, np.ndarray, np.ndarray]:
    preprocessor = build_preprocessor(X_train)
    X_train_encoded = preprocessor.fit_transform(X_train)
    X_val_encoded = preprocessor.transform(X_val)
    return preprocessor, X_train_encoded, X_val_encoded


def build_classifier(spec: HGBSpec) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=spec.max_iter,
        learning_rate=spec.learning_rate,
        max_leaf_nodes=spec.max_leaf_nodes,
        min_samples_leaf=spec.min_samples_leaf,
        l2_regularization=spec.l2_regularization,
        max_features=spec.max_features,
        max_bins=spec.max_bins,
        validation_fraction=spec.validation_fraction,
        n_iter_no_change=spec.n_iter_no_change,
        tol=spec.tol,
        random_state=RANDOM_SEED,
    )


def fit_component(
    spec: HGBSpec,
    X_train: np.ndarray,
    y_train: pd.Series,
) -> tuple[HistGradientBoostingClassifier, float]:
    classifier = build_classifier(spec)
    fit_start = time.time()
    classifier.fit(X_train, y_train)
    fit_seconds = time.time() - fit_start
    return classifier, fit_seconds


def weighted_average_predictions(
    classifiers: list[HistGradientBoostingClassifier],
    specs: tuple[HGBSpec, ...],
    X_val: np.ndarray,
) -> np.ndarray:
    weights = np.array([spec.weight for spec in specs], dtype=float)
    normalized = weights / weights.sum()
    stacked = np.column_stack(
        [classifier.predict_proba(X_val)[:, 1] for classifier in classifiers]
    )
    return stacked @ normalized


def evaluate_ensemble(
    specs: tuple[HGBSpec, ...],
    X_train: np.ndarray,
    y_train: pd.Series,
    X_val: np.ndarray,
    y_val: pd.Series,
) -> tuple[float, float, list[int]]:
    classifiers: list[HistGradientBoostingClassifier] = []
    fit_seconds_total = 0.0
    fitted_iterations: list[int] = []

    for spec in specs:
        classifier, fit_seconds = fit_component(spec, X_train, y_train)
        classifiers.append(classifier)
        fit_seconds_total += fit_seconds
        fitted_iterations.append(classifier.n_iter_)

    val_probs = weighted_average_predictions(classifiers, specs, X_val)
    primary_metric = roc_auc_score(y_val, val_probs)
    return primary_metric, fit_seconds_total, fitted_iterations


def describe_specs(specs: tuple[HGBSpec, ...]) -> str:
    return ",".join(
        f"{spec.name}:{spec.weight:.1f}"
        for spec in specs
    )


def main() -> None:
    t0 = time.time()
    X, y = load_data()
    X_train, X_val, y_train, y_val = split_data(X, y)
    _, X_train_encoded, X_val_encoded = transform_splits(X_train, X_val)

    primary_metric, fit_seconds_total, fitted_iterations = evaluate_ensemble(
        DEFAULT_ENSEMBLE,
        X_train_encoded,
        y_train,
        X_val_encoded,
        y_val,
    )

    print("---")
    print(f"primary_metric:    {primary_metric:.6f}")
    print(f"metric_name:       {PRIMARY_METRIC_NAME}")
    print(f"metric_goal:       {PRIMARY_METRIC_GOAL}")
    print("model_name:        weighted_hgb_ensemble")
    print(f"model_specs:       {describe_specs(DEFAULT_ENSEMBLE)}")
    print(
        "fitted_iterations: "
        + ",".join(str(iterations) for iterations in fitted_iterations)
    )
    print(f"training_seconds:  {fit_seconds_total:.1f}")
    print(f"total_seconds:     {time.time() - t0:.1f}")
    print(f"train_rows:        {len(X_train)}")
    print(f"val_rows:          {len(X_val)}")
    print("status:            ok")


if __name__ == "__main__":
    main()
