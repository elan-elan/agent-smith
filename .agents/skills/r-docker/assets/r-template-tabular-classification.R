# train.R — Multi-model binary classification template for R experiment loops
#
# The mutable experiment surface. Edit CONFIG to change model, hyperparams,
# preprocessing. Designed for the agent-smith edit → run → commit/revert cycle.
#
# Usage: Rscript train.R /workspace/data /workspace/output
#
# Supports: glm, earth, randomForest, ranger, xgboost, glmnet, svm (e1071)
# All packages must be pre-installed in the worker container.

# ── Arguments ────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
input_dir  <- if (length(args) >= 1) args[1] else "/workspace/data"
output_dir <- if (length(args) >= 2) args[2] else "/workspace/output"
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ── Packages (installed by r_worker.sh start, not here) ──────────────
# Wrap every library() call in suppressPackageStartupMessages so stdout
# stays clean for metric parsing.
suppressPackageStartupMessages({
  library(pROC)
  # Model-specific libraries loaded below based on MODEL_TYPE
})

# ══════════════════════════════════════════════════════════════════════
# CONFIG — edit this section each experiment
# ══════════════════════════════════════════════════════════════════════

# Data
DATA_FILE   <- "EDIT_ME.csv"        # filename inside input_dir
TARGET_COL  <- "EDIT_ME"            # binary 0/1 target column

# Split
SEED        <- 42
TEST_FRAC   <- 0.2                  # held-out validation fraction

# Class imbalance — weight ratio applied to positive class during training.
# 1.0 = no reweighting. Higher values (e.g. 10) upweight the minority class.
# Set to "balanced" to auto-compute from class frequencies.
CLASS_WEIGHT <- "balanced"

# Model — one of: "glm", "earth", "randomForest", "ranger",
#                  "xgboost", "glmnet", "svm"
MODEL_TYPE  <- "glm"

# Model hyperparameters (only the block matching MODEL_TYPE is used)
EARTH_PARAMS <- list(degree = 2, nprune = NULL, thresh = 1e-4)
RF_PARAMS    <- list(ntree = 500, mtry = NULL, nodesize = 5)
RANGER_PARAMS <- list(num.trees = 500, mtry = NULL, min.node.size = 5)
XGB_PARAMS   <- list(max_depth = 5, eta = 0.05, nrounds = 200,
                      subsample = 0.8, colsample_bytree = 0.8)
GLMNET_PARAMS <- list(alpha = 0.5, nfolds = 5)
SVM_PARAMS   <- list(kernel = "radial", cost = 1, gamma = NULL)

# ══════════════════════════════════════════════════════════════════════
# DATA LOADING & PREPROCESSING
# ══════════════════════════════════════════════════════════════════════

data_file <- file.path(input_dir, DATA_FILE)
df <- read.csv(data_file, stringsAsFactors = FALSE)
cat("Loaded:", nrow(df), "rows x", ncol(df), "cols\n")

# Auto-convert Yes/No string columns to 0/1
for (col in names(df)) {
  vals <- unique(df[[col]])
  if (is.character(df[[col]]) && length(vals) <= 3 &&
      all(vals %in% c("Yes", "No", NA))) {
    df[[col]] <- ifelse(df[[col]] == "Yes", 1L, 0L)
  }
}

# Auto-convert remaining string columns to factors
for (col in names(df)) {
  if (is.character(df[[col]])) {
    df[[col]] <- as.factor(df[[col]])
  }
}

# ── Stratified train/val split ───────────────────────────────────────
set.seed(SEED)
pos_idx <- which(df[[TARGET_COL]] == 1)
neg_idx <- which(df[[TARGET_COL]] == 0)
pos_val <- sample(pos_idx, size = floor(length(pos_idx) * TEST_FRAC))
neg_val <- sample(neg_idx, size = floor(length(neg_idx) * TEST_FRAC))
val_idx <- c(pos_val, neg_val)

train_df <- df[-val_idx, ]
val_df   <- df[val_idx, ]

y_train <- train_df[[TARGET_COL]]
y_val   <- val_df[[TARGET_COL]]
x_train <- train_df[, setdiff(names(train_df), TARGET_COL), drop = FALSE]
x_val   <- val_df[, setdiff(names(val_df), TARGET_COL), drop = FALSE]

cat("Train:", nrow(train_df), "  Val:", nrow(val_df), "\n")
cat("Train pos rate:", round(mean(y_train), 4),
    "  Val pos rate:", round(mean(y_val), 4), "\n\n")

# ── Compute class weights ────────────────────────────────────────────
if (is.character(CLASS_WEIGHT) && CLASS_WEIGHT == "balanced") {
  pos_rate <- mean(y_train == 1)
  w_pos <- 1 / (2 * pos_rate)
  w_neg <- 1 / (2 * (1 - pos_rate))
} else {
  w_pos <- as.numeric(CLASS_WEIGHT)
  w_neg <- 1.0
}
sample_weights <- ifelse(y_train == 1, w_pos, w_neg)

# ── Helper: numeric matrix from data.frame (one-hot encodes factors) ─
to_matrix <- function(df_in) {
  mm <- model.matrix(~ . - 1, data = df_in)
  storage.mode(mm) <- "double"
  mm
}

# ══════════════════════════════════════════════════════════════════════
# MODEL TRAINING
# ══════════════════════════════════════════════════════════════════════

cat("Fitting model:", MODEL_TYPE, "\n")

if (MODEL_TYPE == "glm") {
  # ── GLM (logistic regression) ────────────────────────────────────
  model <- glm(as.formula(paste(TARGET_COL, "~ .")),
               data = train_df, family = binomial, weights = sample_weights)
  val_probs <- predict(model, newdata = val_df, type = "response")

} else if (MODEL_TYPE == "earth") {
  # ── MARS / earth ────────────────────────────────────────────────
  # earth() handles factors natively — pass data.frame, not matrix.
  # Use earth(weights=...) for class weights (not inside glm= list).
  suppressPackageStartupMessages(library(earth))
  p <- EARTH_PARAMS
  model <- earth(x = x_train, y = y_train, weights = sample_weights,
                 glm = list(family = binomial),
                 degree = p$degree, nprune = p$nprune, thresh = p$thresh)
  val_probs <- as.numeric(predict(model, x_val, type = "response"))

} else if (MODEL_TYPE == "randomForest") {
  # ── Random Forest ───────────────────────────────────────────────
  # randomForest needs y as factor for classification.
  # Use classwt (not weights) for class imbalance.
  suppressPackageStartupMessages(library(randomForest))
  p <- RF_PARAMS
  y_fac <- as.factor(y_train)
  mtry <- if (is.null(p$mtry)) floor(sqrt(ncol(x_train))) else p$mtry
  model <- randomForest(x = x_train, y = y_fac, ntree = p$ntree,
                        mtry = mtry, nodesize = p$nodesize,
                        classwt = c("0" = w_neg, "1" = w_pos))
  val_probs <- predict(model, x_val, type = "prob")[, "1"]

} else if (MODEL_TYPE == "ranger") {
  # ── Ranger (fast RF) ───────────────────────────────────────────
  # ranger accepts case.weights directly.
  suppressPackageStartupMessages(library(ranger))
  p <- RANGER_PARAMS
  train_tmp <- train_df
  train_tmp[[TARGET_COL]] <- as.factor(train_tmp[[TARGET_COL]])
  mtry <- if (is.null(p$mtry)) floor(sqrt(ncol(x_train))) else p$mtry
  model <- ranger(as.formula(paste(TARGET_COL, "~ .")), data = train_tmp,
                  num.trees = p$num.trees, mtry = mtry,
                  min.node.size = p$min.node.size,
                  case.weights = sample_weights, probability = TRUE)
  val_probs <- predict(model, data = val_df)$predictions[, "1"]

} else if (MODEL_TYPE == "xgboost") {
  # ── XGBoost ────────────────────────────────────────────────────
  # xgboost needs numeric matrix — one-hot encode factors.
  # Use scale_pos_weight for imbalance (ratio of neg/pos).
  suppressPackageStartupMessages(library(xgboost))
  p <- XGB_PARAMS
  dtrain <- xgb.DMatrix(data = to_matrix(x_train), label = y_train)
  dval   <- xgb.DMatrix(data = to_matrix(x_val), label = y_val)
  spw <- sum(y_train == 0) / max(sum(y_train == 1), 1)
  params <- list(objective = "binary:logistic", eval_metric = "auc",
                 max_depth = p$max_depth, eta = p$eta,
                 subsample = p$subsample,
                 colsample_bytree = p$colsample_bytree,
                 scale_pos_weight = spw)
  model <- xgb.train(params, dtrain, nrounds = p$nrounds,
                      watchlist = list(val = dval), verbose = 0)
  val_probs <- predict(model, dval)

} else if (MODEL_TYPE == "glmnet") {
  # ── Elastic net (glmnet) ───────────────────────────────────────
  # glmnet needs numeric matrix. Use weights= for class imbalance.
  suppressPackageStartupMessages(library(glmnet))
  p <- GLMNET_PARAMS
  x_mat <- to_matrix(x_train)
  cv_fit <- cv.glmnet(x_mat, y_train, family = "binomial",
                       alpha = p$alpha, nfolds = p$nfolds,
                       weights = sample_weights)
  val_probs <- as.numeric(predict(cv_fit, newx = to_matrix(x_val),
                                   s = "lambda.min", type = "response"))

} else if (MODEL_TYPE == "svm") {
  # ── SVM (e1071) ────────────────────────────────────────────────
  # svm needs numeric matrix for probability output.
  # Use class.weights for imbalance.
  suppressPackageStartupMessages(library(e1071))
  p <- SVM_PARAMS
  x_mat <- to_matrix(x_train)
  model <- svm(x_mat, as.factor(y_train), type = "C-classification",
               kernel = p$kernel, cost = p$cost, gamma = p$gamma,
               class.weights = c("0" = w_neg, "1" = w_pos),
               probability = TRUE)
  pred_obj <- predict(model, to_matrix(x_val), probability = TRUE)
  val_probs <- attr(pred_obj, "probabilities")[, "1"]

} else {
  stop("Unknown MODEL_TYPE: ", MODEL_TYPE)
}

# ══════════════════════════════════════════════════════════════════════
# EVALUATION
# ══════════════════════════════════════════════════════════════════════

val_probs <- as.numeric(val_probs)
roc_obj   <- roc(y_val, val_probs, quiet = TRUE)
val_auc   <- as.numeric(auc(roc_obj))

val_preds <- ifelse(val_probs >= 0.5, 1, 0)
accuracy  <- mean(val_preds == y_val)

tp <- sum(val_preds == 1 & y_val == 1)
fp <- sum(val_preds == 1 & y_val == 0)
fn <- sum(val_preds == 0 & y_val == 1)
precision_val <- if ((tp + fp) > 0) tp / (tp + fp) else 0
recall_val    <- if ((tp + fn) > 0) tp / (tp + fn) else 0
f1_val        <- if ((precision_val + recall_val) > 0) {
  2 * precision_val * recall_val / (precision_val + recall_val)
} else 0

cat("\n===== METRICS =====\n")
cat("val_auc:", val_auc, "\n")
cat("val_accuracy:", accuracy, "\n")
cat("val_f1:", f1_val, "\n")
cat("val_precision:", precision_val, "\n")
cat("val_recall:", recall_val, "\n")
cat("model_type:", MODEL_TYPE, "\n")
cat("===================\n")
