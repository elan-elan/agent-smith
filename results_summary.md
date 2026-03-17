# Results Summary

- source: `/Users/dingyi01/code/agent-smith/results.tsv`
- metric column: `val_auc`
- goal: `higher`
- total experiments: 100
- keep: 18
- discard: 80
- crash: 2

## Overview

- baseline metric: 0.625464
- best metric: 0.668098
- total improvement: 0.042634
- best commit: `n/a`
- best description: gamma=0.5 (CURRENT BEST)

## Frontier

| Run | Commit | Metric | Status | Description |
| --- | --- | --- | --- | --- |
| 1 | `n/a` | 0.625464 | keep | baseline: LogisticRegression(saga, balanced) |
| 3 | `n/a` | 0.636965 | keep | XGBoost(200, depth=6, lr=0.1, scale_pos_weight) |
| 5 | `n/a` | 0.658767 | keep | XGBoost(300, depth=4, lr=0.05) |
| 6 | `n/a` | 0.661686 | keep | XGBoost(400, depth=3, lr=0.05) |
| 8 | `n/a` | 0.662925 | keep | XGBoost(400, d=3, lr=0.05, sub=0.8, col=0.8) |
| 10 | `n/a` | 0.664132 | keep | XGBoost + min_child_weight=5 |
| 13 | `n/a` | 0.665601 | keep | min_child_weight=10 |
| 17 | `n/a` | 0.666053 | keep | subsample=0.7 |
| 20 | `n/a` | 0.666303 | keep | lr=0.03, n=600 |
| 25 | `n/a` | 0.666353 | keep | scale_pos_weight=0.5x |
| 39 | `n/a` | 0.667672 | keep | n=500 (with existing params) |
| 41 | `n/a` | 0.667808 | keep | lr=0.025 |
| 42 | `n/a` | 0.667953 | keep | lr=0.02 |
| 73 | `n/a` | 0.668048 | keep | n=510 |
| 74 | `n/a` | 0.668084 | keep | n=515 |
| 76 | `n/a` | 0.668093 | keep | n=512 |
| 79 | `n/a` | 0.668095 | keep | n=513 |
| 81 | `n/a` | 0.668098 | keep | gamma=0.5 (CURRENT BEST) |

## Recent Runs

| Run | Commit | Metric | Status | Description |
| --- | --- | --- | --- | --- |
| 91 | `n/a` | 0.667867 | discard | n_estimators=520 |
| 92 | `n/a` | 0.667807 | discard | reg_lambda=3 + gamma=0.3 |
| 93 | `n/a` | 0.634679 | discard | ExtraTreesClassifier(500) |
| 94 | `n/a` | 0.639749 | discard | AdaBoost + HistGradientBoosting |
| 95 | `n/a` | 0.665843 | discard | drop torque_rpm/power_rpm |
| 96 | `n/a` | 0.668098 | discard | min_frequency=30 (equal) |
| 97 | `n/a` | 0.666903 | discard | colsample_bylevel=0.8 |
| 98 | `n/a` | 0.667713 | discard | max_delta_step=1 |
| 99 | `n/a` | 0.668098 | discard | grow_policy=lossguide max_leaves=8 (equal) |
| 100 | `n/a` | 0.666721 | discard | VotingClassifier XGB+LGB |
