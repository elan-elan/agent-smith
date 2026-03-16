"""
Baseline prepare.py template for Agent Smith repos.

Adapt this when the user does not already have a prep script. Keep this file
stable and reproducible. Put mutable experiment logic in train.py instead.
"""

from __future__ import annotations

from pathlib import Path


RAW_DATA_DIR = Path("data/raw")
PREPARED_DATA_DIR = Path("data/prepared")
RAW_SOURCE = "{{raw_source}}"


def ensure_raw_data() -> Path:
    """
    Download, copy, or locate the raw dataset.

    Replace this with the repo-specific acquisition logic. Reuse any existing
    Kaggle or shell script instead of duplicating it.
    """
    RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    raise NotImplementedError("Implement raw data acquisition for this repo.")


def build_prepared_artifacts(raw_path: Path) -> Path:
    """
    Transform raw data into stable prepared artifacts.

    Typical outputs are cleaned CSV files, parquet files, tokenized shards,
    train/val splits, or cached metadata needed by train.py.
    """
    PREPARED_DATA_DIR.mkdir(parents=True, exist_ok=True)
    raise NotImplementedError("Implement preprocessing for this repo.")


def main() -> None:
    raw_path = ensure_raw_data()
    prepared_path = build_prepared_artifacts(raw_path)

    print("---")
    print(f"raw_source:        {RAW_SOURCE}")
    print(f"raw_path:          {raw_path}")
    print(f"prepared_path:     {prepared_path}")
    print("status:            ok")


if __name__ == "__main__":
    main()
