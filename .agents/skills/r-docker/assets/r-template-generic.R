# r-template-generic.R — Generic R script template
#
# Usage: Rscript r-template-generic.R <data_dir> [output_dir]
#
# Skeleton for any R task. Fill in the sections marked EDIT.

# ── Arguments ────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
input_dir  <- if (length(args) >= 1) args[1] else "/workspace/data"
output_dir <- if (length(args) >= 2) args[2] else "/workspace/output"
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ── Install packages ─────────────────────────────────────────────────
# EDIT: list the CRAN packages you need
required_packages <- c()
for (pkg in required_packages) {
  if (!requireNamespace(pkg, quietly = TRUE))
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
}

# ── Load data ────────────────────────────────────────────────────────
data_file <- file.path(input_dir, "data.csv")
if (!file.exists(data_file)) {
  stop("Expected data file at: ", data_file)
}
df <- read.csv(data_file)
cat("Loaded:", nrow(df), "rows x", ncol(df), "cols\n")

# ── EDIT: Data preparation ───────────────────────────────────────────
# target_col <- "target"
# set.seed(42)
# n <- nrow(df)
# idx <- sample(n, size = floor(n * 0.8))
# train_df <- df[idx, ]
# val_df   <- df[-idx, ]

# ── EDIT: Model / Analysis ───────────────────────────────────────────
# model <- ...
# pred  <- predict(model, ...)

# ── EDIT: Evaluation ─────────────────────────────────────────────────
# mse <- mean((pred - y_val)^2)

# ── Print metrics ────────────────────────────────────────────────────
cat("\n===== METRICS =====\n")
# cat("val_mse:", mse, "\n")
cat("===================\n")
