"""
One-time data preparation for the insurance claims Agent Smith experiment.

Downloads the Kaggle dataset, applies stable preprocessing, and writes a
prepared CSV that train.py can consume.
"""

from __future__ import annotations

import re
from pathlib import Path

import kagglehub
import pandas as pd


DATASET_HANDLE = "litvinenko630/insurance-claims"
RAW_DIR = Path("data/raw")
RAW_CSV = RAW_DIR / "Insurance claims data.csv"
PREPARED_DIR = Path("data/prepared")
PREPARED_CSV = PREPARED_DIR / "insurance_claims_prepared.csv"
TARGET_COLUMN = "claim_status"
DROP_COLUMNS = ["policy_id"]


def ensure_raw_data() -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    if RAW_CSV.exists():
        return RAW_CSV
    kagglehub.dataset_download(DATASET_HANDLE, output_dir=str(RAW_DIR))
    if not RAW_CSV.exists():
        raise FileNotFoundError(f"Expected raw dataset at {RAW_CSV}")
    return RAW_CSV


def extract_first_float(series: pd.Series) -> pd.Series:
    extracted = series.astype(str).str.extract(r"([0-9]+(?:\.[0-9]+)?)", expand=False)
    return pd.to_numeric(extracted, errors="coerce")


def extract_rpm(series: pd.Series) -> pd.Series:
    extracted = series.astype(str).str.extract(r"@([0-9]+(?:\.[0-9]+)?)rpm", expand=False)
    return pd.to_numeric(extracted, errors="coerce")


def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    prepared = df.copy()

    prepared["max_torque_nm"] = extract_first_float(prepared["max_torque"])
    prepared["max_torque_rpm"] = extract_rpm(prepared["max_torque"])
    prepared["max_power_bhp"] = extract_first_float(prepared["max_power"])
    prepared["max_power_rpm"] = extract_rpm(prepared["max_power"])
    prepared = prepared.drop(columns=["max_torque", "max_power"], errors="ignore")

    yes_no_columns = [
        col
        for col in prepared.columns
        if col.startswith("is_") and prepared[col].dtype == "object"
    ]
    for col in yes_no_columns:
        prepared[col] = prepared[col].map({"Yes": 1, "No": 0}).astype("Int64")

    prepared = prepared.drop(columns=DROP_COLUMNS, errors="ignore")
    prepared[TARGET_COLUMN] = prepared[TARGET_COLUMN].astype(int)
    return prepared


def build_prepared_artifacts(raw_path: Path) -> Path:
    PREPARED_DIR.mkdir(parents=True, exist_ok=True)
    raw_df = pd.read_csv(raw_path)
    prepared_df = preprocess(raw_df)
    prepared_df.to_csv(PREPARED_CSV, index=False)
    return PREPARED_CSV


def main() -> None:
    raw_path = ensure_raw_data()
    prepared_path = build_prepared_artifacts(raw_path)
    prepared_df = pd.read_csv(prepared_path)

    print("---")
    print(f"dataset_handle:    {DATASET_HANDLE}")
    print(f"raw_path:          {raw_path}")
    print(f"prepared_path:     {prepared_path}")
    print(f"rows:              {len(prepared_df)}")
    print(f"columns:           {prepared_df.shape[1]}")
    print(f"target_rate:       {prepared_df[TARGET_COLUMN].mean():.6f}")
    print("status:            ok")


if __name__ == "__main__":
    main()
