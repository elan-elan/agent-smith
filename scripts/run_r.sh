#!/usr/bin/env bash
# run_r.sh — Execute an R script inside a Docker container (rocker/r-ver:latest).
#
# Usage:
#   bash run_r.sh <r_script> <data_dir> [output_dir] [timeout_seconds]
#
# Arguments:
#   r_script        Path to the .R file to execute
#   data_dir        Directory containing input CSV files
#   output_dir      Directory for output artifacts (default: ./r_output)
#   timeout_seconds Max seconds before killing the container (default: 600)
#
# The script is mounted read-only. Data is mounted read-only.
# Output dir is mounted read-write for plots and saved models.
#
# A named Docker volume (r-pkg-cache) persists installed R packages across runs,
# so packages are compiled only once even with --rm.
#
# For experiment loops (many sequential runs), prefer r_worker.sh which keeps
# a persistent container and avoids even the container start/stop overhead.

set -euo pipefail

DOCKER_IMAGE="rocker/r-ver:latest"

# ── Parse arguments ──────────────────────────────────────────────────
if [ $# -lt 2 ]; then
  echo "Usage: bash run_r.sh <r_script> <data_dir> [output_dir] [timeout_seconds]" >&2
  exit 1
fi

R_SCRIPT="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
DATA_DIR="$(cd "$2" && pwd)"
OUTPUT_DIR="${3:-./r_output}"
TIMEOUT="${4:-600}"

# Resolve output dir (create if needed)
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"

# ── Validate inputs ─────────────────────────────────────────────────
if [ ! -f "$R_SCRIPT" ]; then
  echo "Error: R script not found: $R_SCRIPT" >&2
  exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "Error: data directory not found: $DATA_DIR" >&2
  exit 1
fi

# ── Check Docker ─────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is not running. Start Docker and try again." >&2
  exit 1
fi

# ── Pull image if needed ─────────────────────────────────────────────
if ! docker image inspect "$DOCKER_IMAGE" >/dev/null 2>&1; then
  echo "Pulling $DOCKER_IMAGE..."
  docker pull "$DOCKER_IMAGE"
fi

# ── Run ──────────────────────────────────────────────────────────────
echo "Running R script in Docker ($DOCKER_IMAGE)"
echo "  Script:  $R_SCRIPT"
echo "  Data:    $DATA_DIR"
echo "  Output:  $OUTPUT_DIR"
echo "  Timeout: ${TIMEOUT}s"
echo ""

timeout "$TIMEOUT" docker run --rm \
  -v r-pkg-cache:/usr/local/lib/R/site-library \
  -v "$R_SCRIPT":/workspace/script.R:ro \
  -v "$DATA_DIR":/workspace/data:ro \
  -v "$OUTPUT_DIR":/workspace/output \
  -w /workspace \
  "$DOCKER_IMAGE" \
  Rscript script.R /workspace/data /workspace/output

EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
  echo ""
  echo "Error: R script timed out after ${TIMEOUT}s" >&2
  exit 124
elif [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "Error: R script exited with code $EXIT_CODE" >&2
  exit $EXIT_CODE
fi

echo ""
echo "Done. Output saved to: $OUTPUT_DIR"
