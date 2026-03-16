#!/usr/bin/env python3
"""
Summarize an Agent Smith results.tsv file and generate a simple SVG progress plot.

This script intentionally uses only the Python standard library so it can run in
minimal environments without adding plotting dependencies.
"""

from __future__ import annotations

import argparse
import csv
import html
import math
from dataclasses import dataclass
from pathlib import Path


KNOWN_METRIC_COLUMNS = [
    "primary_metric",
    "metric",
    "val_auc",
    "val_accuracy",
    "val_loss",
    "val_bpb",
    "score",
]
LOWER_IS_BETTER_HINTS = ("loss", "error", "rmse", "mae", "bpb", "perplexity")


@dataclass
class ResultRow:
    row_number: int
    commit: str
    metric: float | None
    status: str
    description: str
    raw: dict[str, str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize results.tsv and generate a plot.")
    parser.add_argument("results_path", type=Path, help="Path to results.tsv")
    parser.add_argument("--metric-col", help="Metric column name. Defaults to auto-detect.")
    parser.add_argument(
        "--goal",
        choices=("higher", "lower"),
        help="Optimization direction. Defaults to inference from the metric name.",
    )
    parser.add_argument("--title", help="Optional plot title override.")
    parser.add_argument("--summary-out", type=Path, help="Output markdown path.")
    parser.add_argument("--plot-out", type=Path, help="Output SVG path.")
    return parser.parse_args()


def pick_metric_column(fieldnames: list[str], requested: str | None) -> str:
    if requested:
        if requested not in fieldnames:
            raise ValueError(f"Requested metric column {requested!r} not found in TSV header")
        return requested
    for name in KNOWN_METRIC_COLUMNS:
        if name in fieldnames:
            return name
    for name in fieldnames:
        if name not in {"commit", "status", "description", "memory_gb", "metric_name", "metric_goal"}:
            return name
    raise ValueError("Could not infer a metric column from the TSV header")


def infer_goal(metric_col: str, requested: str | None) -> str:
    if requested:
        return requested
    name = metric_col.lower()
    return "lower" if any(token in name for token in LOWER_IS_BETTER_HINTS) else "higher"


def maybe_float(value: str | None) -> float | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def read_results(path: Path, metric_col: str) -> tuple[list[str], list[ResultRow]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        if not reader.fieldnames:
            raise ValueError("results.tsv is empty or missing a header row")
        rows: list[ResultRow] = []
        for row_number, raw in enumerate(reader, start=1):
            rows.append(
                ResultRow(
                    row_number=row_number,
                    commit=(raw.get("commit") or "").strip(),
                    metric=maybe_float(raw.get(metric_col)),
                    status=(raw.get("status") or "").strip().lower(),
                    description=(raw.get("description") or "").strip(),
                    raw=raw,
                )
            )
    return reader.fieldnames, rows


def is_better(candidate: float, incumbent: float, goal: str) -> bool:
    return candidate > incumbent if goal == "higher" else candidate < incumbent


def running_frontier(rows: list[ResultRow], goal: str) -> list[ResultRow]:
    frontier: list[ResultRow] = []
    best_value: float | None = None
    for row in rows:
        if row.metric is None or row.status == "crash":
            continue
        if best_value is None or is_better(row.metric, best_value, goal):
            frontier.append(row)
            best_value = row.metric
    return frontier


def format_metric(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.6f}"


def build_summary(
    results_path: Path,
    metric_col: str,
    goal: str,
    rows: list[ResultRow],
) -> str:
    valid_rows = [row for row in rows if row.metric is not None and row.status != "crash"]
    frontier = running_frontier(rows, goal)
    baseline = valid_rows[0] if valid_rows else None
    best = frontier[-1] if frontier else None

    counts = {"keep": 0, "discard": 0, "crash": 0}
    for row in rows:
        counts[row.status] = counts.get(row.status, 0) + 1

    improvement = None
    if baseline and best:
        improvement = best.metric - baseline.metric if goal == "higher" else baseline.metric - best.metric

    lines = [
        "# Results Summary",
        "",
        f"- source: `{results_path}`",
        f"- metric column: `{metric_col}`",
        f"- goal: `{goal}`",
        f"- total experiments: {len(rows)}",
        f"- keep: {counts.get('keep', 0)}",
        f"- discard: {counts.get('discard', 0)}",
        f"- crash: {counts.get('crash', 0)}",
        "",
        "## Overview",
        "",
        f"- baseline metric: {format_metric(baseline.metric if baseline else None)}",
        f"- best metric: {format_metric(best.metric if best else None)}",
        f"- total improvement: {format_metric(improvement)}" if improvement is not None else "- total improvement: n/a",
    ]

    if best:
        lines.extend(
            [
                f"- best commit: `{best.commit or 'n/a'}`",
                f"- best description: {best.description or 'n/a'}",
            ]
        )

    lines.extend(["", "## Frontier", "", "| Run | Commit | Metric | Status | Description |", "| --- | --- | --- | --- | --- |"])
    if frontier:
        for row in frontier:
            lines.append(
                f"| {row.row_number} | `{row.commit or 'n/a'}` | {format_metric(row.metric)} | {row.status or 'n/a'} | {row.description or 'n/a'} |"
            )
    else:
        lines.append("| - | - | - | - | No valid experiment rows found |")

    lines.extend(["", "## Recent Runs", "", "| Run | Commit | Metric | Status | Description |", "| --- | --- | --- | --- | --- |"])
    recent_rows = rows[-10:]
    for row in recent_rows:
        lines.append(
            f"| {row.row_number} | `{row.commit or 'n/a'}` | {format_metric(row.metric)} | {row.status or 'n/a'} | {row.description or 'n/a'} |"
        )
    return "\n".join(lines) + "\n"


def placeholder_svg(title: str, message: str) -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="240" viewBox="0 0 1000 240">
  <rect width="1000" height="240" fill="#fbfaf6"/>
  <text x="40" y="70" font-family="Menlo, monospace" font-size="24" fill="#1f2937">{html.escape(title)}</text>
  <text x="40" y="120" font-family="Menlo, monospace" font-size="16" fill="#6b7280">{html.escape(message)}</text>
</svg>
"""


def build_plot_svg(title: str, metric_col: str, goal: str, rows: list[ResultRow]) -> str:
    valid_rows = [row for row in rows if row.metric is not None and row.status != "crash"]
    if not valid_rows:
        return placeholder_svg(title, "No plottable metric rows found in results.tsv")

    frontier = running_frontier(rows, goal)
    width, height = 1200, 720
    left, right, top, bottom = 80, 40, 70, 90
    plot_w = width - left - right
    plot_h = height - top - bottom

    x_min = 1
    x_max = max(row.row_number for row in rows) if rows else 1
    y_values = [row.metric for row in valid_rows if row.metric is not None]
    y_min = min(y_values)
    y_max = max(y_values)
    if math.isclose(y_min, y_max):
        pad = 1.0 if y_min == 0 else abs(y_min) * 0.05
        y_min -= pad
        y_max += pad
    else:
        pad = (y_max - y_min) * 0.08
        y_min -= pad
        y_max += pad

    def x_pos(row_number: int) -> float:
        if x_max == x_min:
            return left + plot_w / 2
        return left + (row_number - x_min) * plot_w / (x_max - x_min)

    def y_pos(metric: float) -> float:
        return top + (y_max - metric) * plot_h / (y_max - y_min)

    elements: list[str] = [
        f'<rect width="{width}" height="{height}" fill="#fbfaf6"/>',
        f'<text x="{left}" y="36" font-family="Menlo, monospace" font-size="24" fill="#111827">{html.escape(title)}</text>',
        f'<text x="{left}" y="58" font-family="Menlo, monospace" font-size="14" fill="#6b7280">metric={html.escape(metric_col)} goal={html.escape(goal)}</text>',
    ]

    for tick_index in range(6):
        y_value = y_min + (y_max - y_min) * tick_index / 5
        y = y_pos(y_value)
        elements.append(f'<line x1="{left}" y1="{y:.1f}" x2="{width-right}" y2="{y:.1f}" stroke="#e5e7eb" stroke-width="1"/>')
        elements.append(
            f'<text x="{left - 12}" y="{y + 5:.1f}" text-anchor="end" font-family="Menlo, monospace" font-size="12" fill="#6b7280">{y_value:.4f}</text>'
        )

    for tick_index in range(min(max(x_max, 1), 10)):
        row_number = 1 + round((x_max - 1) * tick_index / max(1, min(max(x_max, 1), 10) - 1)) if x_max > 1 else 1
        x = x_pos(row_number)
        elements.append(f'<line x1="{x:.1f}" y1="{top}" x2="{x:.1f}" y2="{height-bottom}" stroke="#f1f5f9" stroke-width="1"/>')
        elements.append(
            f'<text x="{x:.1f}" y="{height-bottom + 24}" text-anchor="middle" font-family="Menlo, monospace" font-size="12" fill="#6b7280">{row_number}</text>'
        )

    elements.append(f'<line x1="{left}" y1="{height-bottom}" x2="{width-right}" y2="{height-bottom}" stroke="#111827" stroke-width="2"/>')
    elements.append(f'<line x1="{left}" y1="{top}" x2="{left}" y2="{height-bottom}" stroke="#111827" stroke-width="2"/>')

    if frontier:
        frontier_points = " ".join(f"{x_pos(row.row_number):.1f},{y_pos(row.metric):.1f}" for row in frontier if row.metric is not None)
        elements.append(
            f'<polyline fill="none" stroke="#0f766e" stroke-width="3" points="{frontier_points}"/>'
        )

    for row in valid_rows:
        color = "#16a34a" if row.status == "keep" else "#9ca3af"
        elements.append(
            f'<circle cx="{x_pos(row.row_number):.1f}" cy="{y_pos(row.metric):.1f}" r="4.5" fill="{color}" stroke="#111827" stroke-width="0.8"/>'
        )

    best = frontier[-1] if frontier else None
    if best and best.metric is not None:
        x = x_pos(best.row_number)
        y = y_pos(best.metric)
        elements.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="7" fill="none" stroke="#dc2626" stroke-width="2"/>')
        elements.append(
            f'<text x="{x + 12:.1f}" y="{y - 10:.1f}" font-family="Menlo, monospace" font-size="12" fill="#991b1b">best {best.metric:.6f}</text>'
        )

    elements.append(
        f'<text x="{width / 2:.1f}" y="{height - 24}" text-anchor="middle" font-family="Menlo, monospace" font-size="14" fill="#374151">Experiment #</text>'
    )
    elements.append(
        f'<text x="24" y="{height / 2:.1f}" transform="rotate(-90 24 {height / 2:.1f})" text-anchor="middle" font-family="Menlo, monospace" font-size="14" fill="#374151">{html.escape(metric_col)}</text>'
    )

    return "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\">\n{}\n</svg>\n".format(
        width,
        height,
        width,
        height,
        "\n".join(f"  {element}" for element in elements),
    )


def main() -> None:
    args = parse_args()
    results_path = args.results_path.resolve()
    if not results_path.exists():
        raise FileNotFoundError(f"results file not found: {results_path}")

    with results_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        if not reader.fieldnames:
            raise ValueError("results.tsv is empty or missing a header row")
        fieldnames = reader.fieldnames

    metric_col = pick_metric_column(fieldnames, args.metric_col)
    goal = infer_goal(metric_col, args.goal)
    _, rows = read_results(results_path, metric_col)

    summary_out = args.summary_out or results_path.with_name("results_summary.md")
    plot_out = args.plot_out or results_path.with_name("progress.svg")
    title = args.title or f"Experiment Progress: {results_path.parent.name or results_path.stem}"

    summary_out.write_text(build_summary(results_path, metric_col, goal, rows), encoding="utf-8")
    plot_out.write_text(build_plot_svg(title, metric_col, goal, rows), encoding="utf-8")

    print(f"summary: {summary_out}")
    print(f"plot:    {plot_out}")
    print(f"metric:  {metric_col} ({goal})")
    print(f"rows:    {len(rows)}")


if __name__ == "__main__":
    main()
