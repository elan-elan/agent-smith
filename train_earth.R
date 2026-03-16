# train_earth.R — MARS (earth) binary classification for insurance claims
#
# Mutable experiment surface for the R MARS experiment loop.
# Edit hyperparameters, preprocessing, and model config between runs.
#
# Usage: Rscript train_earth.R /workspace/data /workspace/output

# ── Arguments ────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
input_dir  <- if (length(args) >= 1) args[1] else "/workspace/data"
output_dir <- if (length(args) >= 2) args[2] else "/workspace/output"
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ── Packages ─────────────────────────────────────────────────────────
for (pkg in c("earth", "pROC")) {
  if (!requireNamespace(pkg, quietly = TRUE))
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
}
library(earth)
library(pROC)

# ── Hyperparameters (EDIT THESE) ─────────────────────────────────────
SEED        <- 42
TEST_FRAC   <- 0.2
DEGREE      <- 3
NPRUNE      <- NULL   # NULL = let earth choose
NFOLD       <- 0      # 0 = no CV; set to e.g. 5 for cross-validated pruning
THRESH      <- 0.0001
MINSPAN     <- 0
ENDSPAN     <- 0
FAST_K      <- 20
FAST_BETA   <- 1
PENALTY     <- -1     # -1 = use default; positive value overrides

# ── Load & preprocess ────────────────────────────────────────────────
data_file <- file.path(input_dir, "insurance_claims_prepared.csv")
df <- read.csv(data_file, stringsAsFactors = FALSE)
cat("Loaded:", nrow(df), "rows x", ncol(df), "cols\n")

target_col <- "claim_status"

# Convert Yes/No columns to 0/1
yn_cols <- grep("^is_", names(df), value = TRUE)
for (col in yn_cols) {
  if (is.character(df[[col]])) {
    df[[col]] <- ifelse(df[[col]] == "Yes", 1L, 0L)
  }
}

# Convert categorical string columns to factors
cat_cols <- c("region_code", "segment", "model", "fuel_type",
              "engine_type", "rear_brakes_type", "transmission_type",
              "steering_type")
for (col in cat_cols) {
  if (col %in% names(df)) {
    df[[col]] <- as.factor(df[[col]])
  }
}

# ── Train/test split (stratified) ────────────────────────────────────
set.seed(SEED)
pos_idx <- which(df[[target_col]] == 1)
neg_idx <- which(df[[target_col]] == 0)

pos_test <- sample(pos_idx, size = floor(length(pos_idx) * TEST_FRAC))
neg_test <- sample(neg_idx, size = floor(length(neg_idx) * TEST_FRAC))
test_idx <- c(pos_test, neg_test)

train_df <- df[-test_idx, ]
val_df   <- df[test_idx, ]

cat("Train:", nrow(train_df), "  Val:", nrow(val_df), "\n")
cat("Train positive rate:", mean(train_df[[target_col]]), "\n")
cat("Val positive rate:  ", mean(val_df[[target_col]]), "\n\n")

y_train <- train_df[[target_col]]
y_val   <- val_df[[target_col]]
x_train <- train_df[, setdiff(names(train_df), target_col)]
x_val   <- val_df[, setdiff(names(val_df), target_col)]

# ── Train MARS model ─────────────────────────────────────────────────
cat("Training earth model (degree=", DEGREE, ")...\n")

# Build args list (omit penalty if default)
earth_args <- list(
  x = x_train,
  y = y_train,
  degree    = DEGREE,
  nprune    = NPRUNE,
  thresh    = THRESH,
  minspan   = MINSPAN,
  endspan   = ENDSPAN,
  fast.k    = FAST_K,
  fast.beta = FAST_BETA,
  nfold     = NFOLD,
  glm       = list(family = binomial)
)
if (PENALTY >= 0) earth_args$penalty <- PENALTY

model <- do.call(earth, earth_args)

cat("\nModel summary:\n")
print(summary(model))

# ── Evaluate ─────────────────────────────────────────────────────────
val_probs <- predict(model, x_val, type = "response")
val_probs <- as.numeric(val_probs)

roc_obj <- roc(y_val, val_probs, quiet = TRUE)
val_auc <- as.numeric(auc(roc_obj))

val_preds <- ifelse(val_probs >= 0.5, 1, 0)
accuracy  <- mean(val_preds == y_val)

tp <- sum(val_preds == 1 & y_val == 1)
fp <- sum(val_preds == 1 & y_val == 0)
fn <- sum(val_preds == 0 & y_val == 1)
precision <- if ((tp + fp) > 0) tp / (tp + fp) else 0
recall    <- if ((tp + fn) > 0) tp / (tp + fn) else 0
f1        <- if ((precision + recall) > 0) 2 * precision * recall / (precision + recall) else 0

n_terms <- length(model$selected.terms)

cat("\n===== METRICS =====\n")
cat("val_auc:", val_auc, "\n")
cat("val_accuracy:", accuracy, "\n")
cat("val_f1:", f1, "\n")
cat("val_precision:", precision, "\n")
cat("val_recall:", recall, "\n")
cat("n_terms:", n_terms, "\n")
cat("degree:", DEGREE, "\n")
cat("===================\n")
