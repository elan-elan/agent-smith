---
name: google-earth-crop
description: "Fast Google Earth Web crops with Playwright, including historical imagery before a cutoff date, centered square satellite/aerial crops, red-dot location markers, and CSV/spreadsheet batch crop requests. Make sure to use this skill whenever the user asks for Google Earth imagery, satellite/aerial crops, historical imagery, pre-2020 imagery, latest imagery before a date, or batch crops from rows with coordinates, addresses, or date rules. Prefer direct /data= injection; use UI fallback only if injection fails."
---

# Google Earth Crop

Save one clipped Google Earth Web screenshot for `location` at the newest timeline date before `cutoff_date`.

Inputs: `location`, `cutoff_date` (`YYYY-MM-DD`), `output_path`; optional `zoom_level`, and optional `crop_clip` for viewport `1600x1200`, default centered square `{ x: 410, y: 210, width: 780, height: 780 }`. Default framing should start at `zoom_level: 19`, which maps to about `300m` camera range and keeps the full output resolution instead of cropping a wider image. If zoom 19 fails because close historical tiles are blank or low-detail, try zoom 18 (`600m`), then the intermediate recovery range (`1000m`) with one same-range retry before falling wider, then the large recovery range (`1500m`). For tighter roof inspection, use `zoom_level: 21`, which maps to about `75m` camera range and falls back through zoom 20 and 19 before the recovery ranges.

For every crop, save both the PNG and a concise JSON sidecar next to it. Overlay the target as a red dot on the PNG by default. OCR a small bottom strip from Google Earth's visible bottom status bar by default, but do not append that strip to the saved crop. When a date is confidently parseable, overlay a compact `Image date: YYYY-MM-DD` label at the top left of the crop and store the parsed capture date as `imageDateOcr` in the sidecar. The per-image JSON sidecar should be flat and minimal: `address`, `addressKey`, `dateUsed`, `cutoffDate`, `location`, `outputPath`, `zoomLevel`, `googleEarthQueryUrl`, and `imageDateOcr`. Do not include timing, image-quality analysis, retry history, marker pixel checks, screenshot byte counts, viewport/clip, camera metadata, or OCR debug text in the saved per-image sidecar. Do not label the injected historical timeline date as the actual imagery capture date; only include an imagery capture date in JSON if it is parsed from the visible Google Earth status-bar strip or available from another reliable cross-platform browser or URL source. If Google Earth exposes the same visible image date for different selected timeline renders, report that same image date rather than adding the selected timeline date to the image label or filename.

Use regular Playwright when available; it can run headless and does not require the VS Code browser. Use VS Code browser tools only for visual debugging or if Node/npm installation is impossible.

Before any crop or eval, try local Playwright first. If Playwright or its Chromium browser is unavailable, install it from this skill directory, then continue the requested crop:

```bash
npm install
npx playwright install chromium
```

## Preferred Scripts

Use the bundled scripts before reimplementing the Playwright flow:

- One-off crop: `node scripts/crop_google_earth.mjs --location "LOCATION" --cutoff YYYY-MM-DD --output path/to/crop.png`
- CSV batch requests: follow the Batch Crop Template section below; copy `assets/templates/csv_batch_runner.template.mjs` to `/tmp` and customize only the temporary copy.
- JSON report: written by default next to the PNG using the same basename and `.json` extension. Add `--summary path/to/report.json` to override or `--no-summary` to skip.
- Zoom control: omit `--zoom-level` to use default zoom 19, or add `--zoom-level 21` for tighter roof-level crops. This patches both the Google Earth URL altitude (`a`) and camera range (`d`) fields; it is true source zoom, not a post-capture crop. When a zoom crop fails validation, the scripts try lower zoom levels down to zoom 18, then `--intermediate-fallback-camera-altitude` (`1000m` default) with one same-range retry, then `--large-fallback-camera-altitude` (`1500m` default).
- Custom clip: add `--clip x,y,width,height`. Default is a `780x780` square centered on the query/camera point.
- Red target dot: enabled by default at the centered viewport camera point. Add `--no-marker` to skip or `--marker-radius pixels` to resize.
- Visible date label: enabled by default by OCRing the Google Earth bottom status-bar strip, then overlaying the parsed image date at the top left of the saved crop. The strip is not appended to the output PNG. If OCR cannot parse a date, retry only the tiny bottom-strip screenshot and OCR before saving the final crop without a date overlay. Add `--no-date-label` to skip both OCR and overlay, `--no-date-ocr` to disable OCR and therefore the overlay, or `--date-ocr-retries N` / `--date-ocr-retry-wait-ms MS` to tune retries.
- Wider context: add `--preferred-camera-altitude meters` to bypass zoom-level fallback. Default preferred altitude/range is `500`; the script may fall back wider to avoid blank or low-detail crops.
- Shared implementation: `scripts/google_earth_crop_core.mjs` contains URL readiness, `/data=` date patching, render settle, splash/blank checks, and low-detail checks.

For normal crop requests, run or adapt `scripts/crop_google_earth.mjs`. For batch requests, generate a temporary script from `assets/templates/csv_batch_runner.template.mjs`; it reuses one browser/page, calls `cropGoogleEarth`, writes PNG+JSON sidecars, and writes `batch-summary.json`. Treat the Fast Path below as the behavioral contract for custom code. Only recreate the Playwright sequence manually if the template cannot fit the requested output.

## Batch Crop Template

Use `assets/templates/csv_batch_runner.template.mjs` as the reusable scaffold for future bulk requests. Do not run arbitrary user CSVs directly through the packaged template and do not edit the packaged template for one user run. Instead, inspect the user's CSV headers and request, copy the template to a task-specific file under `/tmp`, customize only the mapping section, run a `--dry-run`, then run the generated `/tmp` script.

The template supports coordinates or address-style headers before customization. Date rules are intentionally customizable because user requests vary. For mapping examples, multiple-date rules, and the stable lower-level pieces to preserve, read `references/csv-batch-template.md`.

Before running a long batch, use `--dry-run` to inspect eligible rows and derived cutoffs. Use `--limit N` only for a small input-order smoke test; for actual batch requests, filter the CSV upstream when the user wants a subset. For template/eval smoke tests, use the packaged fixture `assets/test-data/permit-sample-10.csv`; do not rely on workspace-root sample files. Delete or leave the `/tmp` generated script after the run; it is ephemeral and should not be committed.

Shortcuts: `npm run install:playwright`, `npm run crop -- --location "LOCATION" --output crop.png`, `npm run eval`, `npm run eval:full`, `npm run check`.

## Fast Path

1. Reuse one Playwright page for batches. Set viewport `1600x1200`. For ordinary place names or the first coordinate in a batch, go to `https://earth.google.com/web/search/${encodeURIComponent(location)}?hl=en` with `waitUntil: 'domcontentloaded'`. For later `lat,lon` coordinates on the same page, prefer direct-coordinate URL reuse: keep the current Earth `/data=` URL and replace the URL camera with the target coordinate at the preferred altitude, then navigate with `waitUntil: 'commit'`.
2. Wait only for `/search/`, a `canvas`, `/data=`, and a real URL camera `@lat,lon,alt a` where `alt > 1 && alt < 5_000_000` and `abs(lat)+abs(lon) > 0.001`.
   - If `location` is `lat,lon`, require camera distance from target `< 0.02`; do not reject a valid same-location camera just because it existed before navigation.
   - Otherwise, when reusing a page, require movement from the last confirmed ready camera `> 0.001`.
3. Set `targetDate = cutoff_date - 1 day`. Patch the current `/data=` payload: base64url-decode, replace an existing ISO date if present, otherwise insert bytes `2a100801120a{YYYY-MM-DD}1801` before marker `42020801420208004a` and increase the root varint length by the inserted field length. Patch both URL camera altitude `a` and camera range `d`; changing only `a` records a new altitude but often does not visually zoom. For zoom-level crops, try the requested zoom, then lower zoom levels down to zoom 18, then the intermediate and large recovery ranges. Example for default zoom 19: `[300, 600, 1000, 1500]`, corresponding to zoom 19, zoom 18, intermediate fallback, and large fallback. At `1000m`, retry the same range once before falling to `1500m`. For `--preferred-camera-altitude` runs without `--zoom-level`, use the preferred-altitude path.
4. Navigate to the patched URL with `waitUntil: 'commit'`, wait about `500ms`, decode the last ISO date in `/data=`, and require `selectedDate === targetDate`. Retry date decoding briefly if navigation destroys the execution context. If patching or date validation fails, use fallback. Keep the `500ms` post-history wait.
5. Wait `3500ms` for Earth canvas render, plus a small `100ms` cushion for direct-coordinate URL reuse and about `1000ms` for ultra-close search-start crops. Then screenshot once with `scale: 'css'`, `fullPage: false`, and the centered square clip. Reject splash, blank, or low-detail/blurred tiles. For normal transient low-detail frames, wait `3000ms` and overwrite once, then fail if still invalid. For direct-coordinate recovery only, if the first `500m` screenshot is splash, blank, or extremely low detail and wider candidates remain, skip the same-altitude retry and move directly to the next wider candidate. After validation passes, overlay a red dot at the query/camera center, OCR the visible bottom status-bar strip, overlay the parsed image date at the crop's top left when available, and write that marked PNG at the original crop size.

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

`npm run check` validates bundled scripts, JSON files, and the packaged CSV fixture. `npm run eval` runs the 10-coordinate Google Earth regression through `scripts/benchmark_google_earth_crop.mjs`.

For the CSV batch eval in `evals/evals.json`, use `assets/test-data/permit-sample-10.csv`: copy `assets/templates/csv_batch_runner.template.mjs` to `/tmp`, customize `mapRecordToCropJobs()` for `permit_effective_date` before/after cutoffs, dry-run all 10 rows to confirm 20 planned crops, then run the real smoke with `--limit 1`. Do not depend on workspace-root `permit_sample.csv`.