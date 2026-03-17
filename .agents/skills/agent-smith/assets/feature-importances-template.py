"""Feature importance inspector for sklearn ColumnTransformer + tree model pipelines.

Usage:
    uv run python .agents/skills/agent-smith/assets/feature-importances-template.py

Reconstructs the feature names after one-hot encoding and prints importances
sorted ascending (most important at bottom for easy reading).

Adapt the CONFIG section to match the current experiment's train.py setup.
"""

import pandas as pd
import numpy as np

# ── CONFIG (adapt to match train.py) ─────────────────────────────────────────
DATA_PATH = "data/prepared/insurance_claims_prepared.csv"
TARGET = "claim_status"
TEST_SIZE = 0.2
RANDOM_SEED = 42
# ─────────────────────────────────────────────────────────────────────────────

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

# Load and split (must match train.py's split exactly)
df = pd.read_csv(DATA_PATH)
X = df.drop(columns=[TARGET])
y = df[TARGET].astype(int)
X_train, X_val, y_train, y_val = train_test_split(
    X, y, test_size=TEST_SIZE, random_state=RANDOM_SEED, stratify=y
)

# Detect column types
num_cols = X.select_dtypes(include=["number", "bool"]).columns.tolist()
cat_cols = [c for c in X.columns if c not in num_cols]

# Preprocessing (must match train.py's ColumnTransformer)
preprocess = ColumnTransformer(transformers=[
    ("num", Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ]), num_cols),
    ("cat", Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("encoder", OneHotEncoder(handle_unknown="ignore", min_frequency=20)),
    ]), cat_cols),
])

X_train_t = preprocess.fit_transform(X_train)
X_val_t = preprocess.transform(X_val)

# Fit model (adapt hyperparameters to match train.py)
model = XGBClassifier(
    n_estimators=2000, max_depth=3, learning_rate=0.02,
    subsample=0.7, colsample_bytree=0.8, min_child_weight=10, gamma=0.5,
    scale_pos_weight=0.5 * (y_train == 0).sum() / max((y_train == 1).sum(), 1),
    random_state=RANDOM_SEED, n_jobs=-1, eval_metric="auc",
    early_stopping_rounds=50,
)
model.fit(X_train_t, y_train, eval_set=[(X_val_t, y_val)], verbose=False)

# Reconstruct feature names after one-hot encoding
ohe_names = list(
    preprocess.named_transformers_["cat"]
    .named_steps["encoder"]
    .get_feature_names_out(cat_cols)
)
feature_names = num_cols + ohe_names

# Print sorted importances (ascending — most important at bottom)
importances = model.feature_importances_
for i in np.argsort(importances):
    print(f"{importances[i]:.4f}  {feature_names[i]}")
