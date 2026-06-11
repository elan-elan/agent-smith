# US 10-Coordinate Benchmark

Purpose: verify that the `google-earth-crop` skill is fast without accepting stale cameras, Google Earth splash-screen crops, or unresolved low-resolution tiles.

## Inputs

- `cutoff_date`: `2020-01-01`
- `targetDate`: `2019-12-31`
- viewport: `1600x1200`
- clip: centered square `{ x: 410, y: 210, width: 780, height: 780 }`
- preferred camera altitude: `500m`, with fallback through `700`, `1000`, `1500`, `2000`, `2500`, then the original search altitude
- render settle: `3500ms` after selected-date validation
- minimum detail score: `50`
- red location marker: enabled by default, radius `7px`

## Fixed Random US Coordinates

1. `45.6273,-122.6716` - Vancouver, WA
2. `34.7465,-92.2896` - Little Rock, AR
3. `30.4515,-84.2727` - Tallahassee, FL
4. `43.6150,-116.2023` - Boise, ID
5. `36.1539,-115.1522` - Las Vegas, NV
6. `41.1400,-104.8202` - Cheyenne, WY
7. `32.7767,-96.7970` - Dallas, TX
8. `39.1031,-84.5120` - Cincinnati, OH
9. `46.8772,-96.7898` - Fargo, ND
10. `33.7490,-84.3880` - Atlanta, GA

## Run

From the `google-earth-crop` skill directory:

```bash
npm install
npx playwright install chromium
node scripts/benchmark_google_earth_crop.mjs --output benchmark-runs/us-10-coordinate
```

Shortcut: `npm run eval:full`. The script also attempts `npm install` when the Playwright package is missing, and `npx playwright install chromium` when the browser binary is missing. It writes `benchmark-summary.json` and 10 crop PNGs to the output directory.

The benchmark runner calls the shared implementation in `scripts/google_earth_crop_core.mjs`; regular crop requests should use `scripts/crop_google_earth.mjs` or `npm run crop -- --location "LOCATION" --output path/to/crop.png`.

The benchmark runs headless by default. Add `--headed` only when debugging rendering problems or when the host browser environment lacks working WebGL/canvas support.

## Pass Criteria

- `total` is `10`, `ok` is `10`, and `failed` is `0`.
- Every result has `selectedDate: "2019-12-31"`.
- Every result has `targetDelta <= 0.02`.
- Every result records the requested camera altitude and any adaptive zoom attempts.
- Every result records a visible, centered, pixel-verified red location marker.
- Every final image analysis has `splash: false`, `blank: false`, and `lowDetail: false`.
- The summary includes `total`, `meanMs`, `medianMs`, `minMs`, `maxMs`, `markerVisible`, `markerDrawn`, `markerCentered`, and per-location timings.
- Investigate if mean runtime rises above `23000ms` on a normal local connection; square marked outputs include more pixels, canvas overlay, and marker-pixel verification overhead.

## Failure Modes To Catch

- `@0,0` or globe-altitude readiness accepted as a real crop target.
- Stale previous-camera coordinates accepted for a new coordinate search.
- Search result camera accepted at city scale, making buildings too small.
- Default crop not square or not centered on the query marker.
- Correct URL date but Google Earth splash/loading screen in the crop.
- Byte-size-only screenshot validation accepting a splash screen.
- Date/place-correct crops saved while Google Earth is still showing blurry low-resolution tiles.
- Execution-context-destroyed errors while reading the selected date immediately after navigation.

## Baseline From 2026-06-10

With target-camera readiness and `3500ms` render settle: `10/10` valid crops, mean `9851ms`, median `9498ms`, min `9049ms`, max `13406ms`.

Earlier `500ms` crops were faster but invalid: they accepted stale Las Vegas coordinates for Dallas/Fargo and saved Google Earth splash screenshots.

With adaptive neighborhood zoom plus centered square crop and red marker overlay/pixel verification: `10/10` valid crops, `markerDrawn: 10`, `markerCentered: 10`, mean about `19554ms`, median about `19788ms`, min about `13887ms`, max about `36159ms`.