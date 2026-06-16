#!/usr/bin/env python3

"""
Editable GIF template for downloaded Google Earth crop images.

Copy this file to /tmp, customize the CONFIG block and frame-building helpers,
then run the copy. Keep per-request GIF logic out of scripts/ unless it becomes
a stable, deterministic workflow.

Common uses:
- before_after_grid: a 4x4 grid that alternates before/after images for paired
  filenames such as NAME_before.png and NAME_after.png.
- timeseries_grid: a grid that animates one date/frame at a time from filenames
  grouped by shared location prefixes.

Requires Pillow:
  python3 -m pip install Pillow
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from PIL import Image, ImageDraw, ImageFont

RESAMPLE_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS")


# CUSTOMIZE THIS BLOCK IN THE /tmp COPY.
CONFIG = {
    # "before_after_grid" or "timeseries_grid"
    "mode": "before_after_grid",
    "source_dir": "data/downloaded_google_earth_images",
    "output_gif": "data/example_before_after_grid.gif",
    "manifest_json": "data/example_gif_manifest.json",

    # Grid and tile geometry. Keep total output practical; large GIFs grow fast.
    "columns": 4,
    "rows": 4,
    "tile_size": 240,
    "gap": 6,
    "padding": 18,
    "label_height": 40,
    "background": "#111111",
    "text_fill": "#f4f4f4",
    "muted_fill": "#b9b9b9",

    # before_after_grid settings.
    "before_suffix": "_before.png",
    "after_suffix": "_after.png",
    "selected_bases": [],  # Leave empty to auto-select up to rows*columns pairs.

    # timeseries_grid settings. The default date parser recognizes YYYY-MM-DD or
    # YYYY in filenames. Override group_key_for_timeseries() for custom names.
    "timeseries_glob": "*.png",
    "selected_groups": [],  # Leave empty to auto-select up to rows*columns groups.

    # Frame timing in milliseconds.
    "hold_ms": 900,
    "fade_ms": 90,
    "crossfade_steps": 3,
    "optimize_with_imagemagick": True,
}


@dataclass(frozen=True)
class ImageItem:
    key: str
    date_label: str
    path: Path


def main() -> None:
    source_dir = Path(CONFIG["source_dir"]).expanduser().resolve()
    output_gif = Path(CONFIG["output_gif"]).expanduser().resolve()
    manifest_json = Path(CONFIG["manifest_json"]).expanduser().resolve()

    if CONFIG["mode"] == "before_after_grid":
        frames, durations, manifest = build_before_after_grid(source_dir)
    elif CONFIG["mode"] == "timeseries_grid":
        frames, durations, manifest = build_timeseries_grid(source_dir)
    else:
        raise ValueError(f"unsupported mode: {CONFIG['mode']}")

    output_gif.parent.mkdir(parents=True, exist_ok=True)
    manifest_json.parent.mkdir(parents=True, exist_ok=True)
    save_gif(frames, durations, output_gif)
    maybe_optimize_gif(output_gif)

    manifest_json.write_text(json.dumps({
        "mode": CONFIG["mode"],
        "sourceDir": str(source_dir),
        "outputGif": str(output_gif),
        "frames": len(frames),
        "size": frames[0].size,
        **manifest,
    }, indent=2) + "\n")

    print(json.dumps({
        "gif": str(output_gif),
        "manifest": str(manifest_json),
        "frames": len(frames),
        "size": frames[0].size,
        "bytes": output_gif.stat().st_size,
    }, indent=2))


def build_before_after_grid(source_dir: Path) -> tuple[list[Image.Image], list[int], dict]:
    bases = CONFIG["selected_bases"] or discover_before_after_bases(source_dir)
    bases = bases[:grid_capacity()]
    if not bases:
        raise RuntimeError(f"no before/after pairs found in {source_dir}")

    before_grid = render_grid([
        ImageItem(base, "before", source_dir / f"{base}{CONFIG['before_suffix']}")
        for base in bases
    ], title="Before")
    after_grid = render_grid([
        ImageItem(base, "after", source_dir / f"{base}{CONFIG['after_suffix']}")
        for base in bases
    ], title="After")

    frames, durations = crossfade_loop(before_grid, after_grid)
    return frames, durations, {"selectedBases": bases}


def build_timeseries_grid(source_dir: Path) -> tuple[list[Image.Image], list[int], dict]:
    groups = discover_timeseries_groups(source_dir)
    selected_keys = CONFIG["selected_groups"] or sorted(groups)[:grid_capacity()]
    selected_keys = selected_keys[:grid_capacity()]
    if not selected_keys:
        raise RuntimeError(f"no time-series groups found in {source_dir}")
    missing_keys = [key for key in selected_keys if key not in groups]
    if missing_keys:
        raise RuntimeError(f"selected_groups not found: {', '.join(missing_keys)}")

    selected_groups = {key: groups[key] for key in selected_keys}
    date_labels = sorted({item.date_label for items in selected_groups.values() for item in items})
    if not date_labels:
        raise RuntimeError("no date labels could be parsed from image filenames")

    frames = []
    durations = []
    for date_label in date_labels:
        items = []
        for key in selected_keys:
            match = newest_item_at_or_before(selected_groups[key], date_label)
            items.append(match)
        frames.append(render_grid(items, title=date_label))
        durations.append(CONFIG["hold_ms"])

    return frames, durations, {
        "selectedGroups": selected_keys,
        "dateLabels": date_labels,
    }


def render_grid(items: list[Optional[ImageItem]], title: str) -> Image.Image:
    columns = int(CONFIG["columns"])
    rows = int(CONFIG["rows"])
    tile_size = int(CONFIG["tile_size"])
    gap = int(CONFIG["gap"])
    padding = int(CONFIG["padding"])
    label_height = int(CONFIG["label_height"])
    title_height = label_height
    width = padding * 2 + columns * tile_size + (columns - 1) * gap
    height = padding * 2 + title_height + rows * (tile_size + label_height) + (rows - 1) * gap

    canvas = Image.new("RGB", (width, height), CONFIG["background"])
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    draw.text((padding, padding), title, fill=CONFIG["text_fill"], font=font)

    for index, item in enumerate(items[:grid_capacity()]):
        row = index // columns
        column = index % columns
        x = padding + column * (tile_size + gap)
        y = padding + title_height + row * (tile_size + label_height + gap)
        if item is None:
            draw.rectangle((x, y, x + tile_size, y + tile_size), fill="#202020", outline="#333333")
            draw.text((x + 8, y + 8), "no image yet", fill=CONFIG["muted_fill"], font=font)
            continue
        tile = load_square_tile(item.path, tile_size)
        canvas.paste(tile, (x, y))
        draw.text((x, y + tile_size + 6), compact_label(item.key), fill=CONFIG["text_fill"], font=font)
        draw.text((x, y + tile_size + 22), item.date_label, fill=CONFIG["muted_fill"], font=font)

    return canvas


def load_square_tile(path: Path, tile_size: int) -> Image.Image:
    image = Image.open(path).convert("RGB")
    width, height = image.size
    # Google Earth crops may include an appended bottom date strip. Prefer the
    # satellite square and leave labels/strip out of the animated tile.
    square_edge = min(width, height)
    left = max(0, (width - square_edge) // 2)
    upper = 0
    return image.crop((left, upper, left + square_edge, upper + square_edge)).resize(
        (tile_size, tile_size), RESAMPLE_LANCZOS
    )


def crossfade_loop(first: Image.Image, second: Image.Image) -> tuple[list[Image.Image], list[int]]:
    frames = [first]
    durations = [CONFIG["hold_ms"]]
    for step in range(1, int(CONFIG["crossfade_steps"]) + 1):
        frames.append(Image.blend(first, second, step / (int(CONFIG["crossfade_steps"]) + 1)))
        durations.append(CONFIG["fade_ms"])
    frames.append(second)
    durations.append(CONFIG["hold_ms"])
    for step in range(int(CONFIG["crossfade_steps"]), 0, -1):
        frames.append(Image.blend(first, second, step / (int(CONFIG["crossfade_steps"]) + 1)))
        durations.append(CONFIG["fade_ms"])
    return frames, durations


def save_gif(frames: list[Image.Image], durations: list[int], output_gif: Path) -> None:
    frames[0].save(
        output_gif,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )


def maybe_optimize_gif(output_gif: Path) -> None:
    if not CONFIG["optimize_with_imagemagick"] or shutil.which("magick") is None:
        return
    optimized_path = output_gif.with_suffix(".optimized.gif")
    subprocess.run([
        "magick", str(output_gif), "-layers", "Optimize", str(optimized_path)
    ], check=True)
    optimized_path.replace(output_gif)


def discover_before_after_bases(source_dir: Path) -> list[str]:
    before_suffix = CONFIG["before_suffix"]
    after_suffix = CONFIG["after_suffix"]
    bases = []
    for before_path in sorted(source_dir.glob(f"*{before_suffix}")):
        base = before_path.name[:-len(before_suffix)]
        if (source_dir / f"{base}{after_suffix}").exists():
            bases.append(base)
    return bases


def discover_timeseries_groups(source_dir: Path) -> dict[str, list[ImageItem]]:
    groups: dict[str, list[ImageItem]] = {}
    for image_path in sorted(source_dir.glob(CONFIG["timeseries_glob"])):
        parsed = group_key_for_timeseries(image_path)
        if parsed is None:
            continue
        key, date_label = parsed
        groups.setdefault(key, []).append(ImageItem(key, date_label, image_path))
    for key, items in groups.items():
        groups[key] = sorted(items, key=lambda item: item.date_label)
    return groups


def group_key_for_timeseries(image_path: Path) -> Optional[tuple[str, str]]:
    stem = image_path.stem
    match = re.search(r"(?:^|[_-])((?:19|20)\d{2}-\d{2}-\d{2}|(?:19|20)\d{2})(?:[_-]|$)", stem)
    if not match:
        return None
    date_label = match.group(1)
    key = f"{stem[:match.start()]}{stem[match.end():]}".strip("_-")
    return key or stem, date_label


def newest_item_at_or_before(items: Iterable[ImageItem], date_label: str) -> Optional[ImageItem]:
    candidates = [item for item in items if item.date_label <= date_label]
    return candidates[-1] if candidates else None


def grid_capacity() -> int:
    return int(CONFIG["columns"]) * int(CONFIG["rows"])


def compact_label(value: str) -> str:
    text = value.replace("_", " ").strip()
    return text[:32] + ("..." if len(text) > 32 else "")


if __name__ == "__main__":
    main()