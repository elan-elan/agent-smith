# r-template-earth.R — MARS / earth model template
#
# Usage: Rscript r-template-earth.R <data_dir> [output_dir]
#
# Expects: data_dir/data.csv (or embedding_train.csv + target_train.csv etc.)
# Prints a METRICS block for automated parsing.

# ── Arguments ────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
input_dir  <- if (length(args) >= 1) args[1] else "/workspace/data"
output_dir <- if (length(args) >= 2) args[2] else "/workspace/output"
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ── Install packages ─────────────────────────────────────────────────
for (pkg in c("earth")) {
  if (!requireNamespace(pkg, quietly = TRUE))
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
}
library(earth)

# ── Load data ────────────────────────────────────────────────────────
# Option A: single CSV with target column
# Option B: separate embedding/target CSVs (e.g., from .npy conversion)

data_file <- file.path(input_dir, "data.csv")
if (file.exists(data_file)) {
  df <- read.csv(data_file)
  cat("Loaded:", nrow(df), "rows x", ncol(df), "cols\n")

  # --- Customize these ---
  target_col <- "target"  # EDIT: name of your target column
  seed <- 42
  test_frac <- 0.2
  # -----------------------

  set.seed(seed)
  n <- nrow(df)
  idx <- sample(n, size = floor(n * (1 - test_frac)))
  train_df <- df[idx, ]
  val_df   <- df[-idx, ]

  x_train <- as.matrix(train_df[, setdiff(names(train_df), target_col)])
  y_train <- train_df[[target_col]]
  x_val   <- as.matrix(val_df[, setdiff(names(val_df), target_col)])
  y_val   <- val_df[[target_col]]
} else {
  # Separate CSVs (embedding_train.csv, target_train.csv, etc.)
  x_train <- as.matrix(read.csv(file.path(input_dir, "embedding_train.csv"), header = FALSE))
  y_train <- as.matrix(read.csv(file.path(input_dir, "target_train.csv"),    header = FALSE))
  x_val   <- as.matrix(read.csv(file.path(input_dir, "embedding_val.csv"),   header = FALSE))
  y_val   <- as.matrix(read.csv(file.path(input_dir, "target_val.csv"),      header = FALSE))
}

cat("x_train:", nrow(x_train), "x", ncol(x_train), "\n")
cat("x_val:  ", nrow(x_val),   "x", ncol(x_val),   "\n")
cat("y range: [", min(c(y_train, y_val)), ",", max(c(y_train, y_val)), "]\n\n")

# ── Train MARS model ─────────────────────────────────────────────────
# EDIT: tune degree, nprune, glm family as needed
cat("Training earth model...\n")
model <- earth(x_train, y_train, degree = 1, glm = list(family = gaussian))

cat("\nModel summary:\n")
print(summary(model))

# ── Evaluate ─────────────────────────────────────────────────────────
pred <- predict(model, x_val)

mse  <- mean((pred - y_val)^2)
mae  <- mean(abs(pred - y_val))
rmse <- sqrt(mse)

# R-squared
ss_res <- sum((pred - y_val)^2)
ss_tot <- sum((y_val - mean(y_val))^2)
r2 <- 1 - ss_res / ss_tot

cat("\n===== METRICS =====\n")
cat("val_mse:", mse, "\n")
cat("val_mae:", mae, "\n")
cat("val_rmse:", rmse, "\n")
cat("val_r2:", r2, "\n")
cat("===================\n")
