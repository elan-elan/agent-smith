---
name: google-earth-crop
description: "Fast Google Earth Web crops with Playwright, including historical imagery before a cutoff date, centered square satellite/aerial crops, red-dot location markers, and CSV/spreadsheet batch crop requests. Make sure to use this skill whenever the user asks for Google Earth imagery, satellite/aerial crops, historical imagery, pre-2020 imagery, latest imagery before a date, or batch crops from rows with coordinates, addresses, or date rules. Prefer direct /data= injection; use UI fallback only if injection fails."
---

# Google Earth Crop

Save one clipped Google Earth Web screenshot for `location` at the newest timeline date before `cutoff_date`.

Inputs: `location`, `cutoff_date` (`YYYY-MM-DD`), `output_path`; optional `zoom_level`, and optional `crop_clip` for viewport `1600x1200`, default centered square `{ x: 410, y: 210, width: 780, height: 780 }`. Default framing should start at `zoom_level: 19`, which maps to about `300m` camera range and keeps the full output resolution instead of cropping a wider image. If zoom 19 fails because close historical tiles are blank or low-detail, try zoom 18 (`600m`), then the intermediate recovery range (`1000m`) with one same-range retry before falling wider, then the large recovery range (`1500m`). For tighter roof inspection, use `zoom_level: 21`, which maps to about `75m` camera range and falls back through zoom 20 and 19 before the recovery ranges.

For every crop, save both the PNG and a concise JSON sidecar next to it. Overlay the target as a red dot on the PNG by default. OCR a small bottom strip from Google Earth's visible bottom status bar by default, but do not append that strip to the saved crop. When a date is confidently parseable, overlay a compact `Image date: YYYY-MM-DD` label at the top left of the crop and store the parsed capture date under `parameters.dateLabel.ocr.imageryDate`. The JSON sidecar should be a compact reproducibility manifest only: input location, output path, cutoff/target/selected timeline dates, final camera, zoom/range settings, viewport/clip, marker settings, date-label OCR strip settings, overlay metadata, and OCR capture-date metadata. Do not include timing, image-quality analysis, retry history, marker pixel checks, screenshot byte counts, or other debug details in the saved sidecar. Do not label the injected historical timeline date as the actual imagery capture date; only include an imagery capture date in JSON if it is parsed from the visible Google Earth status-bar strip or available from another reliable cross-platform browser or URL source.

Use regular Playwright when available; it can run headless and does not require the VS Code browser. Use VS Code browser tools only for visual debugging or if Node/npm installation is impossible.

Before any crop or eval, try local Playwright first. If Playwright or its Chromium browser is unavailable, install it from this skill directory, then continue the requested crop:

```bash
npm install
npx playwright install chromium
```

## Preferred Scripts

Use the bundled scripts before reimplementing the Playwright flow:

- One-off crop: `node scripts/crop_google_earth.mjs --location "LOCATION" --cutoff YYYY-MM-DD --output path/to/crop.png`
- Batch crop template: `node scripts/crop_permits_batch.mjs --csv permit_sample.csv --output data/permits_sample_v2 --sample-size 30 --seed permit-sample-v2-20260615`. Use this as the starting point for spreadsheet/CSV batch requests instead of creating a fresh Playwright loop.
- JSON report: written by default next to the PNG using the same basename and `.json` extension. Add `--summary path/to/report.json` to override or `--no-summary` to skip.
- Zoom control: omit `--zoom-level` to use default zoom 19, or add `--zoom-level 21` for tighter roof-level crops. This patches both the Google Earth URL altitude (`a`) and camera range (`d`) fields; it is true source zoom, not a post-capture crop. When a zoom crop fails validation, the scripts try lower zoom levels down to zoom 18, then `--intermediate-fallback-camera-altitude` (`1000m` default) with one same-range retry, then `--large-fallback-camera-altitude` (`1500m` default).
- Custom clip: add `--clip x,y,width,height`. Default is a `780x780` square centered on the query/camera point.
- Red target dot: enabled by default at the centered viewport camera point. Add `--no-marker` to skip or `--marker-radius pixels` to resize.
- Visible date label: enabled by default by OCRing the Google Earth bottom status-bar strip, then overlaying the parsed image date at the top left of the saved crop. The strip is not appended to the output PNG. If OCR cannot parse a date, retry only the tiny bottom-strip screenshot and OCR before saving the final crop without a date overlay. Add `--no-date-label` to skip both OCR and overlay, `--no-date-ocr` to disable OCR and therefore the overlay, or `--date-ocr-retries N` / `--date-ocr-retry-wait-ms MS` to tune retries.
- OCR backfill: only for legacy crops with appended strips, run `node scripts/ocr_date_label.mjs --input path/to/crop.png --json path/to/crop.json` to add or refresh `parameters.dateLabel.ocr` without rerunning Google Earth.
- Wider context: add `--preferred-camera-altitude meters` to bypass zoom-level fallback and use the older adaptive altitude sequence. Default preferred altitude/range is `500`; the script may fall back wider to avoid blank or low-detail crops.
- Shared implementation: `scripts/google_earth_crop_core.mjs` contains URL readiness, `/data=` date patching, render settle, splash/blank checks, and low-detail checks.

For normal crop requests, run or adapt `scripts/crop_google_earth.mjs`. For batch requests, run or adapt `scripts/crop_permits_batch.mjs`; it reuses one browser/page, calls `cropGoogleEarth`, writes PNG+JSON sidecars, retries failed crops, retries missing/implausible OCR dates once by default, and writes `batch-summary.json`. Treat the Fast Path below as the behavioral contract for custom code. Only recreate the Playwright sequence manually if the scripts cannot fit the requested output.

## Batch Crop Template

Use `scripts/crop_permits_batch.mjs` as the reusable example for future bulk requests. The current script was built for `permit_sample.csv` with `lon`, `lat`, `addr_tract_key`, and `permit_effective_date`, then samples unique path-safe address keys and creates `before`/`after` crops with cutoffs at permit date minus/plus one year. It saves final names like `{addr_tract_key}_{before|after}_{YYYY-MM-DD}.png`, where the date is the parsed visible OCR imagery date when plausible, otherwise the query cutoff date.

When a future batch input differs, adapt the data-mapping functions near the bottom of the script rather than rewriting the crop engine:

- `parsePermitRows`: change CSV/header parsing and validation. For raw or uncleaned addresses, set `row.location` to the full address/place query that Google Earth should search; for coordinates, keep `row.location` as `lat,lon`. Preserve original source fields in the row object so the sidecar can record them.
- `cropPhases`: change date parsing and cutoff derivation. Normalize all derived cutoffs to `YYYY-MM-DD` before calling `cropGoogleEarth`. This is the right place for custom windows, event dates, before/after offsets, or already-provided cutoff columns.
- `baseLabel` construction and `filenameDateFor`: change output naming. Sanitize raw addresses for filenames, but do not over-clean the search query passed as `location`.
- `sampledRowForSummary` and `compactCropManifest`: update batch summaries and sidecars for the user's source columns and date rules.
- Keep `cropWithRetries`, browser/page reuse, marker/date-label options, and `cropGoogleEarth` calls unless there is a specific reason to change behavior.

Before running a long batch, use `--dry-run` to inspect selected rows and derived cutoffs. For batch requests where every row must be processed, set `--sample-size` to the desired row count or adapt `selectSample` to preserve input order instead of random sampling.

When asked to run the eval/benchmark, run it automatically:

```bash
node scripts/benchmark_google_earth_crop.mjs --output benchmark-runs/us-10-coordinate
```

Shortcuts: `npm run install:playwright`, `npm run crop -- --location "LOCATION" --output crop.png`, `npm run crop:permits-batch -- --csv permit_sample.csv --output data/permits_sample_v2`, `npm run eval`, `npm run eval:full`, `npm run check`.

## Fast Path

1. Reuse one Playwright page for batches. Set viewport `1600x1200`. For ordinary place names or the first coordinate in a batch, go to `https://earth.google.com/web/search/${encodeURIComponent(location)}?hl=en` with `waitUntil: 'domcontentloaded'`. For later `lat,lon` coordinates on the same page, prefer direct-coordinate URL reuse: keep the current Earth `/data=` URL and replace the URL camera with the target coordinate at the preferred altitude, then navigate with `waitUntil: 'commit'`.
2. Wait only for `/search/`, a `canvas`, `/data=`, and a real URL camera `@lat,lon,alt a` where `alt > 1 && alt < 5_000_000` and `abs(lat)+abs(lon) > 0.001`.
   - If `location` is `lat,lon`, require camera distance from target `< 0.02`; do not reject a valid same-location camera just because it existed before navigation.
   - Otherwise, when reusing a page, require movement from the last confirmed ready camera `> 0.001`.
3. Set `targetDate = cutoff_date - 1 day`. Patch the current `/data=` payload: base64url-decode, replace an existing ISO date if present, otherwise insert bytes `2a100801120a{YYYY-MM-DD}1801` before marker `42020801420208004a` and increase the root varint length by the inserted field length. Patch both URL camera altitude `a` and camera range `d`; changing only `a` records a new altitude but often does not visually zoom. For zoom-level crops, try the requested zoom, then lower zoom levels down to zoom 18, then the intermediate and large recovery ranges. Example for default zoom 19: `[300, 600, 1000, 1500]`, corresponding to zoom 19, zoom 18, intermediate fallback, and large fallback. At `1000m`, retry the same range once before falling to `1500m`. For `--preferred-camera-altitude` runs without `--zoom-level`, use the older adaptive altitude sequence.
4. Navigate to the patched URL with `waitUntil: 'commit'`, wait about `500ms`, decode the last ISO date in `/data=`, and require `selectedDate === targetDate`. Retry date decoding briefly if navigation destroys the execution context. If patching or date validation fails, use fallback. Do not shorten the `500ms` post-history wait; the full benchmark showed shorter waits cause retries.
5. Wait `3500ms` for Earth canvas render, plus a small `100ms` cushion for direct-coordinate URL reuse and about `1000ms` for ultra-close search-start crops. Then screenshot once with `scale: 'css'`, `fullPage: false`, and the centered square clip. Reject splash, blank, or low-detail/blurred tiles. For normal transient low-detail frames, wait `3000ms` and overwrite once, then fail if still invalid. For direct-coordinate recovery only, if the first `500m` screenshot is splash, blank, or extremely low detail and wider candidates remain, skip the same-altitude retry and move directly to the next wider candidate. After validation passes, overlay a red dot at the query/camera center, OCR the visible bottom status-bar strip, overlay the parsed image date at the crop's top left when available, and write that marked PNG at the original crop size.

Skip `networkidle`, startup screenshots, accessibility/read-page dumps, popup cleanup, keyboard cleanup, menu clicks before fallback, full-page screenshots, and visual calibration.

## Fallback

Only after fast-path failure: keep the default viewport; click Projects dismiss `(45,150)`, `View` `(176.5,16)`, `Show historical imagery` `(294,140)`, then previous-image chevron `(600,120)` until decoded URL date is before `cutoff_date`. Avoid `Escape`, `Tab`, `Enter`, and `Space`; they can clear or miss the historical date.

Report saved PNG path, JSON sidecar path, decoded date, marker metadata, `fast-path`/`fallback`, and elapsed time.

## Benchmark

2026-06-10, 10 random US coordinate crops, cutoff `2020-01-01`, direct injection, target-camera readiness, fixed `3500ms` render settle: `10/10` valid crops, mean `9.851s`, median `9.498s`, min `9.049s`, max `13.406s`. With adaptive neighborhood zoom plus centered square crop and red marker overlay/pixel verification: `10/10`, `markerDrawn: 10`, `markerCentered: 10`, mean about `19.554s`, median about `19.788s`.

2026-06-11 Agent Smith full-suite optimization, 10 coordinate crops, cutoff `2020-01-01`: baseline full-suite mean `8.363s`; best policy mean `7.943s`, `10/10` valid crops, `markerDrawn: 10`, `markerCentered: 10`, `retries: 0`. The best policy skips the same-altitude retry only for doomed direct-coordinate `500m` recovery screenshots when wider candidates remain; do not skip ordinary low-detail retries because transient tiles often recover on retry.

Observed fixes: `500ms` after injection is enough for URL date but can still save the Google Earth splash; screenshot byte size misses that failure. Camera movement alone can accept stale locations; coordinate searches need target proximity. Blurry low-resolution tiles can pass date/place checks, so the benchmark also requires a minimum crop detail score. Do not lower the `1000ms` ultra-close search-start cushion, remove the `100ms` direct-coordinate render cushion, lower base render settle to `3250ms`, or shorten direct-coordinate post-history wait to `300ms`; full-suite probes regressed or introduced retries.

Repeatable regression test: `evals/evals.json`, `benchmarks/us-10-coordinate-benchmark.md`, and `scripts/benchmark_google_earth_crop.mjs`. Reusable crop implementation: `scripts/crop_google_earth.mjs` backed by `scripts/google_earth_crop_core.mjs`.