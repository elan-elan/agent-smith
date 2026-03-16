#!/usr/bin/env python3
"""csv_convert.py — Convert common data formats to CSV for R ingestion.

Usage:
    python csv_convert.py <input_file> [output_file]

Supported formats: .npy, .npz, .parquet, .tsv, .json, .xlsx, .feather, .pkl

If output_file is omitted, writes to the same directory with a .csv extension.
"""

import sys
from pathlib import Path


def convert_npy(src: Path, dst: Path) -> None:
    import numpy as np
    a = np.load(src)
    if a.ndim == 1:
        a = a.reshape(-1, 1)
    np.savetxt(dst, a, delimiter=",")
    print(f"  {src.name}: shape {a.shape} → {dst.name}")


def convert_npz(src: Path, dst: Path) -> None:
    import numpy as np
    data = np.load(src)
    out_dir = dst.parent
    for key in data.files:
        a = data[key]
        if a.ndim == 1:
            a = a.reshape(-1, 1)
        out_path = out_dir / f"{key}.csv"
        np.savetxt(out_path, a, delimiter=",")
        print(f"  {key}: shape {a.shape} → {out_path.name}")


def convert_pandas(src: Path, dst: Path, **read_kwargs) -> None:
    import pandas as pd
    readers = {
        ".parquet": pd.read_parquet,
        ".tsv": lambda f: pd.read_csv(f, sep="\t"),
        ".json": pd.read_json,
        ".xlsx": pd.read_excel,
        ".feather": pd.read_feather,
        ".pkl": pd.read_pickle,
    }
    suffix = src.suffix.lower()
    reader = readers.get(suffix)
    if reader is None:
        raise ValueError(f"Unsupported format: {suffix}")
    df = reader(src)
    df.to_csv(dst, index=False)
    print(f"  {src.name}: {len(df)} rows × {len(df.columns)} cols → {dst.name}")


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    src = Path(sys.argv[1])
    if not src.exists():
        print(f"Error: file not found: {src}", file=sys.stderr)
        sys.exit(1)

    dst = Path(sys.argv[2]) if len(sys.argv) >= 3 else src.with_suffix(".csv")

    suffix = src.suffix.lower()
    print(f"Converting {src} → {dst}")

    if suffix == ".npy":
        convert_npy(src, dst)
    elif suffix == ".npz":
        convert_npz(src, dst)
    elif suffix in (".parquet", ".tsv", ".json", ".xlsx", ".feather", ".pkl"):
        convert_pandas(src, dst)
    elif suffix == ".csv":
        print("  Already CSV, nothing to do.")
    else:
        print(f"Error: unsupported format: {suffix}", file=sys.stderr)
        sys.exit(1)

    print("Done.")


if __name__ == "__main__":
    main()
