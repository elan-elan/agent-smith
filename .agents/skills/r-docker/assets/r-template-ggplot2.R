# r-template-ggplot2.R — Publication-quality visualization template
#
# Usage: Rscript r-template-ggplot2.R <data_dir> [output_dir]
#
# Expects: data_dir/data.csv
# Saves plots to output_dir as PNG (300 dpi) and optionally PDF.

# ── Arguments ────────────────────────────────────────────────────────
args <- commandArgs(trailingOnly = TRUE)
input_dir  <- if (length(args) >= 1) args[1] else "/workspace/data"
output_dir <- if (length(args) >= 2) args[2] else "/workspace/output"
dir.create(output_dir, showWarnings = FALSE, recursive = TRUE)

# ── Install packages ─────────────────────────────────────────────────
for (pkg in c("ggplot2")) {
  if (!requireNamespace(pkg, quietly = TRUE))
    install.packages(pkg, repos = "https://cloud.r-project.org", quiet = TRUE)
}
library(ggplot2)

# ── Load data ────────────────────────────────────────────────────────
data_file <- file.path(input_dir, "data.csv")
if (!file.exists(data_file)) {
  stop("Expected data file at: ", data_file)
}
df <- read.csv(data_file)
cat("Loaded:", nrow(df), "rows x", ncol(df), "cols\n")
cat("Columns:", paste(names(df), collapse = ", "), "\n\n")

# ── EDIT BELOW: Define your plots ────────────────────────────────────

# --- Customize these ---
x_var <- names(df)[1]  # EDIT: x-axis variable
y_var <- names(df)[2]  # EDIT: y-axis variable
# -----------------------

# Plot 1: Scatter plot
p1 <- ggplot(df, aes(x = .data[[x_var]], y = .data[[y_var]])) +
  geom_point(alpha = 0.5, size = 1.5) +
  theme_minimal(base_size = 14) +
  theme(
    plot.title = element_text(face = "bold"),
    panel.grid.minor = element_blank()
  ) +
  labs(
    title = paste(y_var, "vs", x_var),
    x = x_var,
    y = y_var
  )

ggsave(file.path(output_dir, "scatter.png"), p1,
       width = 8, height = 6, dpi = 300)
cat("Saved: scatter.png\n")

# Plot 2: Distribution of y variable
p2 <- ggplot(df, aes(x = .data[[y_var]])) +
  geom_histogram(bins = 30, fill = "#2c7bb6", color = "white", alpha = 0.8) +
  theme_minimal(base_size = 14) +
  theme(
    plot.title = element_text(face = "bold"),
    panel.grid.minor = element_blank()
  ) +
  labs(
    title = paste("Distribution of", y_var),
    x = y_var,
    y = "Count"
  )

ggsave(file.path(output_dir, "histogram.png"), p2,
       width = 8, height = 6, dpi = 300)
cat("Saved: histogram.png\n")

# ── Summary ──────────────────────────────────────────────────────────
cat("\n===== METRICS =====\n")
cat("plots_saved: 2\n")
cat("output_dir:", output_dir, "\n")
cat("===================\n")
