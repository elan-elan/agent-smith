# prepare.R — Data preparation template for R experiment loops
#
# Analogous to prepare.py. Reads raw CSV, applies stable preprocessing,
# and writes a prepared CSV that train.R can consume.
#
# Usage: Rscript prepare.R /workspace/data
#
# This is a ONE-TIME script. Do not modify between experiments.
# All experiment-level changes go in train.R.

# ── Arguments ────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
data_dir <- if (length(args) >= 1) args[1] else "/workspace/data"

# ══════════════════════════════════════════════════════════════════════
# CONFIG — set these once for the dataset
# ══════════════════════════════════════════════════════════════════════
RAW_FILE      <- "EDIT_ME_raw.csv"         # filename of raw CSV
PREPARED_FILE <- "EDIT_ME_prepared.csv"     # filename for output
TARGET_COL    <- "EDIT_ME"                  # target column name
DROP_COLS     <- c("id")                    # columns to drop (IDs, leaky features)

# ══════════════════════════════════════════════════════════════════════
# LOAD
# ══════════════════════════════════════════════════════════════════════
raw_path <- file.path(data_dir, RAW_FILE)
stopifnot(file.exists(raw_path))
df <- read.csv(raw_path, stringsAsFactors = FALSE)
cat("Raw rows:", nrow(df), " cols:", ncol(df), "\n")

# ══════════════════════════════════════════════════════════════════════
# PREPROCESSING — stable transforms, do not change between experiments
# ══════════════════════════════════════════════════════════════════════

# Drop specified columns
df <- df[, !(names(df) %in% DROP_COLS), drop = FALSE]

# Convert Yes/No columns to 0/1
for (col in names(df)) {
  vals <- unique(df[[col]])
  if (is.character(df[[col]]) && all(vals %in% c("Yes", "No", NA))) {
    df[[col]] <- ifelse(df[[col]] == "Yes", 1L, 0L)
  }
}

# Convert remaining string columns to factors (train.R decides encoding)
for (col in names(df)) {
  if (is.character(df[[col]])) {
    df[[col]] <- as.factor(df[[col]])
  }
}

# Ensure target is integer for classification
if (TARGET_COL %in% names(df)) {
  df[[TARGET_COL]] <- as.integer(df[[TARGET_COL]])
}

# ══════════════════════════════════════════════════════════════════════
# WRITE
# ══════════════════════════════════════════════════════════════════════
out_path <- file.path(data_dir, PREPARED_FILE)
write.csv(df, out_path, row.names = FALSE)

cat("\n---\n")
cat("raw_path:      ", raw_path, "\n")
cat("prepared_path: ", out_path, "\n")
cat("rows:          ", nrow(df), "\n")
cat("columns:       ", ncol(df), "\n")
if (TARGET_COL %in% names(df)) {
  cat("target_rate:   ", sprintf("%.6f", mean(df[[TARGET_COL]], na.rm = TRUE)), "\n")
}
cat("status:         ok\n")
