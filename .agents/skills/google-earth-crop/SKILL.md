---
name: google-earth-crop
description: "Fast Google Earth Web crops with Playwright, including historical imagery before a cutoff date, centered square satellite/aerial crops, and red-dot location markers. Make sure to use this skill whenever the user asks for Google Earth imagery, satellite/aerial crops, historical imagery, pre-2020 imagery, or latest imagery before a date. Prefer direct /data= injection; use UI fallback only if injection fails."
---

# Google Earth Crop

Save one clipped Google Earth Web screenshot for `location` at the newest timeline date before `cutoff_date`.

Inputs: `location`, `cutoff_date` (`YYYY-MM-DD`), `output_path`; optional `crop_clip` for viewport `1600x1200`, default centered square `{ x: 410, y: 210, width: 780, height: 780 }`. Default framing should be a small neighborhood around the target, covering a few buildings; prefer about `500m` camera altitude, then fall back wider if close historical tiles are blank or low-detail.

For every crop, save both the PNG and a JSON sidecar next to it. Overlay the target as a red dot on the PNG by default. The JSON should record the selected timeline date, camera, marker coordinates/pixel check, output path, timing, and image-quality analysis.

Use regular Playwright when available; it can run headless and does not require the VS Code browser. Use VS Code browser tools only for visual debugging or if Node/npm installation is impossible.

Before any crop or eval, try local Playwright first. If Playwright or its Chromium browser is unavailable, install it from this skill directory, then continue the requested crop:

```bash
npm install
npx playwright install chromium
```

## Preferred Scripts

Use the bundled scripts before reimplementing the Playwright flow:

- One-off crop: `node scripts/crop_google_earth.mjs --location "LOCATION" --cutoff YYYY-MM-DD --output path/to/crop.png`
- JSON report: written by default next to the PNG using the same basename and `.json` extension. Add `--summary path/to/report.json` to override or `--no-summary` to skip.
- Custom clip: add `--clip x,y,width,height`. Default is a `780x780` square centered on the query/camera point.
- Red target dot: enabled by default at the centered viewport camera point. Add `--no-marker` to skip or `--marker-radius pixels` to resize.
- Wider context: add `--preferred-camera-altitude meters`. Default preferred altitude is `500`; the script may fall back wider to avoid blank or low-detail crops.
- Shared implementation: `scripts/google_earth_crop_core.mjs` contains URL readiness, `/data=` date patching, render settle, splash/blank checks, and low-detail checks.

For normal crop requests, run or adapt `scripts/crop_google_earth.mjs`. Treat the Fast Path below as the behavioral contract for custom code. Only recreate the Playwright sequence manually if the script cannot fit the requested output.

When asked to run the eval/benchmark, run it automatically:

```bash
node scripts/benchmark_google_earth_crop.mjs --output benchmark-runs/us-10-coordinate
```

Shortcuts: `npm run install:playwright`, `npm run crop -- --location "LOCATION" --output crop.png`, `npm run eval`, `npm run eval:full`, `npm run check`.

## Fast Path

1. Reuse one Playwright page for batches. Set viewport `1600x1200`; go to `https://earth.google.com/web/search/${encodeURIComponent(location)}?hl=en` with `waitUntil: 'domcontentloaded'`.
2. Wait only for `/search/`, a `canvas`, `/data=`, and a real URL camera `@lat,lon,alt a` where `alt > 1 && alt < 5_000_000` and `abs(lat)+abs(lon) > 0.001`.
   - If `location` is `lat,lon`, require camera distance from target `< 0.02`; do not reject a valid same-location camera just because it existed before navigation.
   - Otherwise, when reusing a page, require movement from the last confirmed ready camera `> 0.001`.
3. Set `targetDate = cutoff_date - 1 day`. Patch the current `/data=` payload: base64url-decode, replace an existing ISO date if present, otherwise insert bytes `2a100801120a{YYYY-MM-DD}1801` before marker `42020801420208004a` and increase the root varint length by the inserted field length. Try URL camera altitudes `[500, 700, 1000, 1500, 2000, 2500, original]`, skipping values wider than the original camera, until the crop passes image checks.
4. Navigate to the patched URL with `waitUntil: 'commit'`, wait about `500ms`, decode the last ISO date in `/data=`, and require `selectedDate === targetDate`. Retry date decoding briefly if navigation destroys the execution context. If patching or date validation fails, use fallback.
5. Wait `3500ms` for Earth canvas render, then screenshot once with `scale: 'css'`, `fullPage: false`, and the centered square clip. Reject splash, blank, or low-detail/blurred tiles; wait `3000ms` and overwrite once, then fail if still invalid. After validation passes, overlay a red dot at the query/camera center and write that marked PNG.

Skip `networkidle`, startup screenshots, accessibility/read-page dumps, popup cleanup, keyboard cleanup, menu clicks before fallback, full-page screenshots, and visual calibration.

## Fallback

Only after fast-path failure: keep the default viewport; click Projects dismiss `(45,150)`, `View` `(176.5,16)`, `Show historical imagery` `(294,140)`, then previous-image chevron `(600,120)` until decoded URL date is before `cutoff_date`. Avoid `Escape`, `Tab`, `Enter`, and `Space`; they can clear or miss the historical date.

Report saved PNG path, JSON sidecar path, decoded date, marker metadata, `fast-path`/`fallback`, and elapsed time.

## Benchmark

2026-06-10, 10 random US coordinate crops, cutoff `2020-01-01`, direct injection, target-camera readiness, fixed `3500ms` render settle: `10/10` valid crops, mean `9.851s`, median `9.498s`, min `9.049s`, max `13.406s`. With adaptive neighborhood zoom plus centered square crop and red marker overlay/pixel verification: `10/10`, `markerDrawn: 10`, `markerCentered: 10`, mean about `19.554s`, median about `19.788s`.

Observed fixes: `500ms` after injection is enough for URL date but can still save the Google Earth splash; screenshot byte size misses that failure. Camera movement alone can accept stale locations; coordinate searches need target proximity. Blurry low-resolution tiles can pass date/place checks, so the benchmark also requires a minimum crop detail score.

Repeatable regression test: `evals/evals.json`, `benchmarks/us-10-coordinate-benchmark.md`, and `scripts/benchmark_google_earth_crop.mjs`. Reusable crop implementation: `scripts/crop_google_earth.mjs` backed by `scripts/google_earth_crop_core.mjs`.