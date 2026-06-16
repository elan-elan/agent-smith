---
name: google-earth-crop
description: "Fast Google Earth Web crops with Playwright, including historical imagery before a cutoff date, centered square satellite/aerial crops, red-dot location markers, and CSV/spreadsheet batch crop requests. Make sure to use this skill whenever the user asks for Google Earth imagery, satellite/aerial crops, historical imagery, pre-2020 imagery, latest imagery before a date, or batch crops from rows with coordinates, addresses, or date rules. Prefer direct /data= injection; use UI fallback only if injection fails."
---

# Google Earth Crop

Save one clipped Google Earth Web screenshot for `location` at the newest timeline date before `cutoff_date`.

Inputs: `location`, `cutoff_date` (`YYYY-MM-DD`), `output_path`; optional `zoom_level`, and optional `crop_clip` for viewport `1600x1200`, default centered square `{ x: 410, y: 210, width: 780, height: 780 }`. Default framing should start at `zoom_level: 19`, which maps to about `300m` camera range and keeps the full output resolution instead of cropping a wider image. If zoom 19 fails because close historical tiles are blank or low-detail, try zoom 18 (`600m`), then the intermediate recovery range (`1000m`) with one same-range retry before falling wider, then the large recovery range (`1500m`). When the user asks for the same apparent zoom/extent across multiple dates, enable `--match-requested-zoom-extent`; then, if a lower zoom-level fallback succeeds, center-crop and resize the screenshot back to the original output size before adding the dot, date text, OCR, or bottom strip. One zoom level lower uses the center 60% of width and height, two levels lower uses the center 36%, and so on. For tighter roof inspection, use `zoom_level: 21`, which maps to about `75m` camera range and falls back through zoom 20 and 19 before the recovery ranges.

For every crop, save both the PNG and a concise JSON sidecar next to it. Overlay the target as a red dot on the PNG by default. Capture a small bottom strip from Google Earth's visible bottom status bar by default, append that strip below the saved crop, and OCR it for the imagery capture date. The appended strip gives the user a visual fallback if OCR cannot parse the date. When a date is confidently parseable, overlay a compact `Image date: YYYY-MM-DD` label at the top left of the crop and store the parsed capture date as `imageDateOcr` in the sidecar. Treat OCR qualifiers like `older` or `newer` as parsing hints only; do not include them in overlays, filenames, JSON sidecars, or parsed OCR result fields. The per-image JSON sidecar should be flat and minimal: `address`, `addressKey`, `dateUsed`, `cutoffDate`, `location`, `outputPath`, `zoomLevel`, `googleEarthQueryUrl`, and `imageDateOcr`. Do not include timing, image-quality analysis, retry history, marker pixel checks, screenshot byte counts, viewport/clip, camera metadata, or OCR debug text in the saved per-image sidecar. Do not label the injected historical timeline date as the actual imagery capture date; only include an imagery capture date in JSON if it is parsed from the visible Google Earth status-bar strip or available from another reliable cross-platform browser or URL source. If Google Earth exposes the same visible image date for different selected timeline renders, report that same image date rather than adding the selected timeline date to the image label or filename.

Use regular Playwright when available; it can run headless and does not require the VS Code browser. Use VS Code browser tools only for visual debugging or if Node/npm installation is impossible.

Before any crop or eval, try local Playwright first. If Playwright or its Chromium browser is unavailable, install it from this skill directory, then continue the requested crop:

```bash
npm install
npx playwright install chromium
```

## Preferred Scripts

Use the bundled scripts before reimplementing the Playwright flow:

- One-off crop: `node scripts/crop_google_earth.mjs --location "LOCATION" --cutoff YYYY-MM-DD --output path/to/crop.png`
- CSV batch: `node scripts/crop_csv_batch.mjs --csv normalized.csv --output output_dir`. Each CSV row must have `query_date`, `output_name`, and one location source: either `lat`+`lon` or `address`.
- JSON report: written by default next to the PNG using the same basename and `.json` extension. Add `--summary path/to/report.json` to override or `--no-summary` to skip.
- Zoom control: omit `--zoom-level` to use default zoom 19, or add `--zoom-level 21` for tighter roof-level crops. This patches both the Google Earth URL altitude (`a`) and camera range (`d`) fields; it is true source zoom, not a post-capture crop. Add `--match-requested-zoom-extent` only when the user wants consistent apparent zoom across dates: if a lower zoom-level fallback succeeds, the saved PNG is center-cropped and resized back to the original output dimensions before marker, text, OCR, and strip processing. For example, zoom 19 falling back to zoom 18 uses the center 60% of the screenshot width and height before resizing. After lower zoom-level fallbacks, the scripts try `--intermediate-fallback-camera-altitude` (`1000m` default) with one same-range retry, then `--large-fallback-camera-altitude` (`1500m` default); those recovery ranges are left as wider-context images.
- Custom clip: add `--clip x,y,width,height`. Default is a `780x780` square centered on the query/camera point.
- Red target dot: enabled by default at the centered viewport camera point with a compact `4px` radius so small buildings remain visible. Add `--no-marker` to skip or `--marker-radius pixels` to resize.
- Visible date label: enabled by default by capturing the already-visible Google Earth bottom status-bar strip, appending that strip below the saved crop, OCRing it, then overlaying the parsed image date at the top left when OCR succeeds. Do not open/toggle historical imagery controls before the first strip capture; some locations already expose the date and menu clicks can disturb it. If OCR cannot parse a date, retry only the tiny bottom-strip screenshot and OCR, then try revealing the historical UI as a fallback before the final strip capture. Always save the final captured strip appended for manual inspection. Add `--no-date-label` to skip strip capture/appending, OCR, and overlay; add `--no-date-ocr` to append the strip but skip OCR and therefore the overlay; or use `--date-ocr-retries N` / `--date-ocr-retry-wait-ms MS` to tune retries.
- Wider context: add `--preferred-camera-altitude meters` to bypass zoom-level fallback. Default preferred altitude/range is `500`; the script may fall back wider to avoid blank or low-detail crops.
- Shared implementation: `scripts/google_earth_crop_core.mjs` contains URL readiness, `/data=` date patching, render settle, splash/blank checks, and low-detail checks.

For normal crop requests, run or adapt `scripts/crop_google_earth.mjs`. For batch requests, run `scripts/crop_csv_batch.mjs` against a normalized CSV; it reuses one browser/page, calls `cropGoogleEarth`, writes PNG+JSON sidecars, and writes `batch-summary.json`. Treat the Fast Path below as the behavioral contract for custom code.

## CSV Batch

Use `scripts/crop_csv_batch.mjs` for the standard batch path. Its input is deterministic and supports two canonical row formats:

- Coordinate rows: `lat`, `lon`, `query_date`, `output_name`
- Address rows: `address`, `query_date`, `output_name`

`query_date` must be `YYYY-MM-DD` and is passed as the crop cutoff date. `output_name` is the PNG basename; include request-specific labels such as `addr_tract_key_before` or `addr_tract_key_after` there. Optional metadata column: `address_key`. If `address` is present with `lat`/`lon`, `lat`/`lon` is used as the location and `address` is kept as metadata.

If a user's CSV does not already match this schema, copy `assets/templates/normalize_csv.template.mjs` to `/tmp`, customize `normalizeRecordToRows()` for the source headers and date rules, write a normalized CSV, inspect it, then run `scripts/crop_csv_batch.mjs`. Keep generated normalizer scripts under `/tmp`; do not commit per-request converters.

Keep `assets/templates/csv_batch_runner.template.mjs` only as an escape hatch for unusual custom workflows that cannot be represented as normalized `query_date`/`output_name` rows with either `lat`/`lon` or `address`. The deterministic batch script should be the default.

For normalization examples, multiple-date rules, and the stable lower-level pieces to preserve, read `references/csv-batch-template.md`.

Before running a long batch, use `--dry-run` to inspect rows, query dates, and output names. Use `--limit N` only for a small input-order smoke test; for actual batch requests, filter the CSV upstream when the user wants a subset. If a crop succeeds but the bottom-strip OCR cannot parse an imagery date, `scripts/crop_csv_batch.mjs` retries from a fresh browser context by default (`--missing-ocr-retry-mode fresh-context`) instead of only reusing the same page; use `--missing-ocr-retry-mode same-page` only when you explicitly want the older lighter retry. For eval smoke tests, use the packaged normalized fixture `assets/test-data/coordinate-sample-10.csv`; do not rely on workspace-root sample files.

Shortcuts: `npm run install:playwright`, `npm run crop -- --location "LOCATION" --output crop.png`, `npm run crop:csv -- --csv normalized.csv --output output_dir`, `npm run eval`, `npm run eval:csv`, `npm run eval:csv:address`, `npm run eval:moorpark`, `npm run eval:full`, `npm run check`.

## GIFs From Downloaded Images

When the user asks for an animated GIF from already-downloaded crop images, use `assets/templates/gif_from_images.template.py` as a copy-and-customize starting point. Copy it to `/tmp`, edit the `CONFIG` block and any grouping/label helpers for the specific image names, then run the `/tmp` copy. Keep one-off GIF composition logic in the copied template rather than adding a new `scripts/` file; `scripts/` is for stable deterministic crop/eval runners, while GIF demos usually need request-specific layout, labels, selection, timing, and grouping rules.

The template supports two common modes:

- `before_after_grid`: finds paired files such as `NAME_before.png` and `NAME_after.png`, renders a fixed grid, and crossfades between the two states.
- `timeseries_grid`: groups filenames by location key and date token, keeps each location in a stable grid position, and animates through dates.

Use Pillow (`python3 -m pip install Pillow` if needed). ImageMagick's `magick` command is optional for GIF optimization. Write a small manifest JSON next to the GIF recording the selected bases/groups, frame count, source directory, and output path so the demo can be regenerated or audited later.

## Fast Path

1. Reuse one Playwright page for batches. Set viewport `1600x1200`. For ordinary place names or the first coordinate in a batch, go to `https://earth.google.com/web/search/${encodeURIComponent(location)}?hl=en` with `waitUntil: 'domcontentloaded'`. For later `lat,lon` coordinates on the same page, prefer direct-coordinate URL reuse: keep the current Earth `/data=` URL and replace the URL camera with the target coordinate at the preferred altitude, then navigate with `waitUntil: 'commit'`.
2. Wait only for `/search/`, a `canvas`, `/data=`, and a real URL camera `@lat,lon,alt a` where `alt > 1 && alt < 5_000_000` and `abs(lat)+abs(lon) > 0.001`.
   - If `location` is `lat,lon`, require camera distance from target `< 0.02`; do not reject a valid same-location camera just because it existed before navigation.
   - Otherwise, when reusing a page, require movement from the last confirmed ready camera `> 0.001`.
3. Set `targetDate = cutoff_date - 1 day`. Patch the current `/data=` payload: base64url-decode, replace an existing ISO date if present, otherwise insert bytes `2a100801120a{YYYY-MM-DD}1801` before marker `42020801420208004a` and increase the root varint length by the inserted field length. Patch both URL camera altitude `a` and camera range `d`; changing only `a` records a new altitude but often does not visually zoom. For zoom-level crops, try the requested zoom, then lower zoom levels down to zoom 18, then the intermediate and large recovery ranges. Example for default zoom 19: `[300, 600, 1000, 1500]`, corresponding to zoom 19, zoom 18, intermediate fallback, and large fallback. Only when `--match-requested-zoom-extent` is set and a lower zoom level is the final accepted zoom, post-process the saved crop with a simple centered crop/resize before overlays so the final PNG covers the same requested zoom extent: `crop_ratio = 0.6 ** (requested_zoom - final_zoom)`. At `1000m`, retry the same range once before falling to `1500m`. For `--preferred-camera-altitude` runs without `--zoom-level`, use the preferred-altitude path.
4. Navigate to the patched URL with `waitUntil: 'commit'`, wait about `500ms`, decode the last ISO date in `/data=`, and require `selectedDate === targetDate`. Retry date decoding briefly if navigation destroys the execution context. If patching or date validation fails, use fallback. Keep the `500ms` post-history wait.
5. Wait `3500ms` for Earth canvas render, plus a small `100ms` cushion for direct-coordinate URL reuse and about `1000ms` for ultra-close search-start crops. Then screenshot once with `scale: 'css'`, `fullPage: false`, and the centered square clip. Reject splash, blank, low-detail tiles, or blurred target-area tiles; blur detection uses a Laplacian sharpness score on the center `55%` of the crop, not the full image edges. For normal transient low-detail/blurred frames, first try a before-cutoff historical tile refresh: click older, then newer, then older up to two more times as needed; after each click, accept the candidate only when the decoded URL date is on or before `cutoff_date - 1 day` and the center crop passes detail/sharpness validation. If the refresh lands after the cutoff, reject it and reset the page before the next zoom candidate so Google Earth's visual state is not polluted. If that guarded refresh cannot run, wait `3000ms` and overwrite once, then fail if still invalid. For direct-coordinate recovery fallbacks after the requested zoom, if the screenshot is splash, blank, or extremely low detail and wider candidates remain, skip the same-altitude retry and move directly to the next wider candidate. After validation passes, overlay a red dot at the query/camera center, capture and OCR the visible bottom status-bar strip, overlay the parsed image date at the crop's top left when available, append the visible strip below the crop, and write that combined PNG.

Skip `networkidle`, startup screenshots, accessibility/read-page dumps, popup cleanup, keyboard cleanup, menu clicks before fallback, full-page screenshots, and visual calibration.

## Fallback

Only after fast-path failure: keep the default viewport; click Projects dismiss `(45,150)`, `View` `(176.5,16)`, `Show historical imagery` `(294,140)`, then previous-image chevron `(600,120)` until decoded URL date is before `cutoff_date`. Avoid `Escape`, `Tab`, `Enter`, and `Space`; they can clear or miss the historical date.

Report saved PNG path, JSON sidecar path, decoded date, marker metadata, and `fast-path`/`fallback`.

## Eval

Run evals from the skill directory:

```bash
npm run check
npm run eval
```

`npm run check` validates bundled scripts, templates, JSON files, and the packaged normalized CSV fixture. `npm run eval` runs the 10-coordinate Google Earth regression through `scripts/benchmark_google_earth_crop.mjs`.

For the CSV batch eval in `evals/evals.json`, use `assets/test-data/coordinate-sample-10.csv` to cover coordinate rows and `assets/test-data/address-sample-2.csv` to cover address rows. Dry-run all normalized rows and confirm `output_name` already contains the requested before/after naming, then run the real smoke with `--limit 1` and outputs under `benchmark-runs/` so the PNG, JSON sidecar, and `batch-summary.json` stay with benchmark artifacts instead of `/tmp`. Use `assets/test-data/moorpark-date-ocr.csv` / `npm run eval:moorpark` for the Moorpark OCR regression: address `W 12801 MOORPARK, CA 91604`, cutoff `2014-12-18`, expected parsed `imageDateOcr` `2014-04-24`, and no `older` qualifier in the overlay or parsed OCR fields. Do not depend on workspace-root project CSV files.