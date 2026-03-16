# R Model Cookbook

Read this reference **before writing any R model code** for the experiment loop.
It covers the exact API for each model, common pitfalls, and runtime expectations.

## Quick Reference Table

| Model | Package | Classification setup | Weight param | predict() for probs | Needs numeric matrix? |
|---|---|---|---|---|---|
| glm | base R | `family = binomial` | `weights =` | `predict(m, newdata, type = "response")` | No |
| earth | earth | `glm = list(family = binomial)` | `weights =` on earth() call | `predict(m, x, type = "response")` | No (handles factors) |
| randomForest | randomForest | y must be `factor` | `classwt = c("0" = w0, "1" = w1)` | `predict(m, x, type = "prob")[, "1"]` | No |
| ranger | ranger | y must be `factor`, `probability = TRUE` | `case.weights =` | `predict(m, data = x)$predictions[, "1"]` | No |
| xgboost | xgboost | `objective = "binary:logistic"` | `scale_pos_weight =` | `predict(m, dmatrix)` (returns probs directly) | **Yes** — one-hot encode |
| glmnet | glmnet | `family = "binomial"` | `weights =` | `predict(cv_fit, newx, s = "lambda.min", type = "response")` | **Yes** — one-hot encode |
| svm | e1071 | `type = "C-classification"`, `probability = TRUE` | `class.weights = c("0" = w0, "1" = w1)` | `attr(predict(m, x, probability = TRUE), "probabilities")[, "1"]` | **Yes** — one-hot encode |

## One-hot encoding for matrix-based models

xgboost, glmnet, and svm need a pure numeric matrix. Use `model.matrix()`:

```r
to_matrix <- function(df_in) {
  mm <- model.matrix(~ . - 1, data = df_in)
  storage.mode(mm) <- "double"
  mm
}
```

This expands factors into dummy columns. The `- 1` drops the intercept to avoid
the dummy-variable trap (xgboost/glmnet handle this internally).

## Known Pitfalls

### earth (MARS)

- **Do NOT pass `penalty = NULL` explicitly** — earth() crashes with `'penalty' is NULL`.
  Omit the parameter entirely to use the default.
- **Weights go on the `earth()` call, not inside `glm = list(...)`**.
  Wrong: `earth(x, y, glm = list(family = binomial, weights = w))` → crashes.
  Right: `earth(x, y, weights = w, glm = list(family = binomial))`.
- **`nfold > 0` multiplies runtime by ~nfold × 2.** On 40K+ rows with degree ≥ 3,
  this can take 10+ minutes. Avoid nfold for initial exploration; use it only for
  final model selection on the best config.
- **degree = 3 is slow on large datasets.** Expect 2-5× the time of degree = 2.
  Start with degree = 1 or 2 for baseline, only try 3 if degree = 2 shows promise.
- earth handles factors natively — no need to one-hot encode.

### randomForest

- **y must be `factor()` for classification.** If you pass numeric 0/1,
  randomForest silently does regression instead. Always: `y_fac <- as.factor(y_train)`.
- **Use `classwt =`, not `weights =`.** The `classwt` param takes a named vector:
  `classwt = c("0" = 1.0, "1" = 15.0)`. The names must match factor levels.
- **Slow on >50K rows with ntree = 500.** Consider `ranger` as a faster alternative
  with a nearly identical API.

### ranger

- **y must be `factor()` in the data.frame** for classification with `probability = TRUE`.
- Use `case.weights =` (per-sample weights), not `classwt`.
- Prediction returns a matrix: `predict(m, data = x)$predictions[, "1"]`.

### xgboost

- **Requires numeric matrix.** Pass data through `to_matrix()` / `model.matrix()`.
- Use `scale_pos_weight = n_neg / n_pos` for class imbalance (not sample weights).
- `xgb.DMatrix()` is the input format: `xgb.DMatrix(data = mat, label = y)`.
- `xgb.train()` returns probabilities directly from `predict()` for binary:logistic.
- Set `verbose = 0` to suppress per-round output that clutters run.log.

### glmnet

- **Requires numeric matrix.** Use `to_matrix()`.
- Always use `cv.glmnet()` to auto-select lambda via cross-validation.
- Extract probabilities with `predict(cv_fit, newx, s = "lambda.min", type = "response")`.
  The result is a matrix — wrap in `as.numeric()`.
- `alpha = 1` is lasso, `alpha = 0` is ridge, `0 < alpha < 1` is elastic net.

### svm (e1071)

- **Requires numeric matrix** for `probability = TRUE` to work reliably.
- **Slow on >10K rows.** On 50K rows, can take minutes even with a simple kernel.
  Consider subsampling the training set for initial exploration.
- Probabilities: `attr(predict(m, x, probability = TRUE), "probabilities")[, "1"]`.
  The column name must match the factor level — use `"1"` not `1`.
- `class.weights` takes a named vector: `c("0" = w0, "1" = w1)`.

### glm

- Fastest model to fit. Good baseline before trying complex models.
- Can produce convergence warnings on high-dimensional data — these are usually harmless
  for prediction quality but indicate possible multicollinearity.
- `weights =` accepts a per-sample weight vector directly.

## Runtime Expectations

Approximate wall-clock time on ~50K rows, ~40 features (Docker on Apple Silicon):

| Model | Baseline config | Expected time |
|---|---|---|
| glm | default | 1-3s |
| earth degree=1 | default thresh | 5-15s |
| earth degree=2 | thresh=1e-4 | 15-60s |
| earth degree=3 | thresh=1e-4 | 60-300s |
| earth degree=2 + nfold=5 | | 120-600s |
| randomForest | ntree=500 | 30-120s |
| ranger | num.trees=500 | 10-30s |
| xgboost | nrounds=200 | 5-15s |
| glmnet + cv | nfolds=5 | 3-10s |
| svm (radial) | default | 60-300s |

Use these to set realistic timeout values. For initial model exploration, prefer
fast models (glm, glmnet, xgboost, ranger) before investing time in slow ones.

## Recommended Exploration Order

For a multi-model experiment loop aiming to maximize AUC:

1. **glm** — fast baseline, establishes a floor
2. **glmnet** — regularized version, often beats glm
3. **xgboost** — usually the strongest; tune max_depth, eta, nrounds
4. **ranger** — fast RF, competitive with xgboost on tabular data
5. **earth degree=2** — captures nonlinear effects glm misses
6. **randomForest** — if ranger shows promise, try RF for comparison
7. **earth degree=3** — only if degree=2 was competitive
8. **svm** — last resort; slow and rarely beats xgboost on tabular data

## Standard Package Set

Pre-install all of these when starting the R worker for a multi-model loop:

```bash
bash scripts/r_worker.sh start data/prepared r_output -- \
  pROC earth randomForest ranger xgboost glmnet e1071
```

This avoids mid-loop package installation delays.
