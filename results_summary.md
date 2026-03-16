# Results Summary

- source: `/Users/yirending/code/autotuning/results.tsv`
- metric column: `primary_metric`
- goal: `higher`
- total experiments: 102
- keep: 6
- discard: 96
- crash: 0

## Overview

- baseline metric: 0.625464
- best metric: 0.669402
- total improvement: 0.043938
- best commit: `blend-002`
- best description: hgb_rand_052@0.7 + hgb_rand_033@0.3

## Frontier

| Run | Commit | Metric | Status | Description |
| --- | --- | --- | --- | --- |
| 1 | `aefbeba` | 0.625464 | keep | baseline logistic regression with one-hot preprocessing |
| 2 | `exp-001` | 0.667145 | keep | hgb_fast_regularized lr=0.05 iter=200 leaf=15 minleaf=5 l2=0.1 feat=0.5 bins=128 |
| 53 | `exp-052` | 0.668878 | keep | hgb_rand_052 lr=0.08 iter=700 leaf=15 minleaf=30 l2=1.0 feat=0.7 bins=255 |
| 92 | `blend-001` | 0.668984 | keep | hgb_rand_052@0.7 + hgb_fast_regularized@0.3 |
| 93 | `blend-002` | 0.669402 | keep | hgb_rand_052@0.7 + hgb_rand_033@0.3 |

## Recent Runs

| Run | Commit | Metric | Status | Description |
| --- | --- | --- | --- | --- |
| 93 | `blend-002` | 0.669402 | keep | hgb_rand_052@0.7 + hgb_rand_033@0.3 |
| 94 | `blend-003` | 0.668606 | discard | hgb_rand_052@0.7 + hgb_rand_013@0.3 |
| 95 | `blend-004` | 0.668956 | discard | hgb_rand_052@0.7 + hgb_rand_044@0.3 |
| 96 | `blend-005` | 0.667637 | discard | hgb_fast_regularized@0.7 + hgb_rand_033@0.3 |
| 97 | `blend-006` | 0.667659 | discard | hgb_fast_regularized@0.7 + hgb_rand_013@0.3 |
| 98 | `blend-007` | 0.667456 | discard | hgb_fast_regularized@0.7 + hgb_rand_044@0.3 |
| 99 | `blend-008` | 0.667260 | discard | hgb_rand_033@0.7 + hgb_rand_013@0.3 |
| 100 | `blend-009` | 0.667155 | discard | hgb_rand_033@0.7 + hgb_rand_044@0.3 |
| 101 | `blend-010` | 0.666874 | discard | hgb_rand_013@0.7 + hgb_rand_044@0.3 |
| 102 | `final-default` | 0.669402 | keep | default train.py ensemble matching blend-002 |
