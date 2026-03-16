# R Task: {{task_title}}

## Data
- Input: {{data_path}}
- Format: CSV
- Target column: {{target_col}}
- Number of features: {{n_features}}

## Model
- Type: {{model_type}}
- R packages: {{packages}}
- Key hyperparameters:
  - {{param1}}: {{value1}}
  - {{param2}}: {{value2}}

## Train/Test Split
- Method: random (stratified if classification)
- Train fraction: 0.8
- Seed: 42

## Evaluation
- Primary metric: {{primary_metric}}
- Additional metrics: {{additional_metrics}}
- Print all metrics in ===== METRICS ===== block

## Output
- Save predictions to output/predictions.csv
- Save plots to output/ (if visualization requested)

## Notes
{{user_notes}}
