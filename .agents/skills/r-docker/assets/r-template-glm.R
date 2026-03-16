# r-template-glm.R — Generalized Linear Model template
#
# Usage: Rscript r-template-glm.R <data_dir> [output_dir]
#
# Expects: data_dir/data.csv with a target column.
# Prints a METRICS block for automated parsing.

# ── Arguments ────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
input_dir  <- if (length(args) >= 1) args[1] else "/workspace/data"
output_dir <- if (length(args) >= 2) args[2] else "/workspace/output"
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ── Load data ────────────────────────────────────────────────────────
data_file <- file.path(input_dir, "data.csv")
if (!file.exists(data_file)) {
  stop("Expected data file at: ", data_file)
}
df <- read.csv(data_file)
cat("Loaded:", nrow(df), "rows x", ncol(df), "cols\n")

# --- Customize these ---
target_col <- "target"       # EDIT: name of your target column
family     <- binomial       # EDIT: gaussian, binomial, poisson, etc.
seed       <- 42
test_frac  <- 0.2
# -----------------------

# ── Train/test split ─────────────────────────────────────────────────
set.seed(seed)
n <- nrow(df)
idx <- sample(n, size = floor(n * (1 - test_frac)))
train_df <- df[idx, ]
val_df   <- df[-idx, ]

cat("Train:", nrow(train_df), " Val:", nrow(val_df), "\n")

# ── Fit GLM ──────────────────────────────────────────────────────────
formula <- as.formula(paste(target_col, "~ ."))
cat("\nFitting glm with family =", deparse(substitute(family)), "...\n")
model <- glm(formula, data = train_df, family = family)

cat("\nModel summary:\n")
print(summary(model))

# ── Evaluate ─────────────────────────────────────────────────────────
pred_prob <- predict(model, newdata = val_df, type = "response")
y_val <- val_df[[target_col]]

# Regression metrics (always computed)
mse  <- mean((pred_prob - y_val)^2)
mae  <- mean(abs(pred_prob - y_val))
rmse <- sqrt(mse)

cat("\n===== METRICS =====\n")
cat("val_mse:", mse, "\n")
cat("val_mae:", mae, "\n")
cat("val_rmse:", rmse, "\n")

# Classification metrics (if binary target)
if (all(y_val %in% c(0, 1))) {
  pred_class <- ifelse(pred_prob > 0.5, 1, 0)
  accuracy <- mean(pred_class == y_val)
  cat("val_accuracy:", accuracy, "\n")

  # AUC (manual trapezoidal — no extra packages)
  pos <- pred_prob[y_val == 1]
  neg <- pred_prob[y_val == 0]
  auc <- mean(outer(pos, neg, FUN = function(a, b) (a > b) + 0.5 * (a == b)))
  cat("val_auc:", auc, "\n")
}

cat("===================\n")
