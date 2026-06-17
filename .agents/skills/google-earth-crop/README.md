# Google Earth Crop

Human-facing guide for prompting the `google-earth-crop` skill. Agent instructions live in `SKILL.md`.

This skill captures Google Earth Web crops for places or coordinates, including historical imagery at the newest timeline date before a cutoff date. It saves a marked PNG plus a compact JSON sidecar with address/location metadata, the selected timeline date used, cutoff date, output path, zoom level, Google Earth query URL, and the OCR-parsed visible image date when available.

Default framing starts at zoom level 19 as a centered square neighborhood crop around the target, usually a few buildings rather than a city-scale map. If close historical imagery is blank, low-detail, or center-blurry, the skill tries guarded before-cutoff historical refresh candidates, then zoom 18, then 1000m with one same-range retry, then 1500m. When comparing the same location across multiple dates, ask for consistent apparent zoom to enable `--match-requested-zoom-extent`; then a fallback is center-cropped and resized back to the original output size before overlays. One zoom level lower uses the center 50% of width and height before resizing, two levels lower uses the center 25%, and 1000m/1500m recovery fallbacks use the center 30%. The blur detector scores the center 55% of the crop so the target area drives the decision.


![4x4 before/after Google Earth crop demo](../../../data/google_earth_crop_before_after_grid.gif)


## How To Prompt It

Ask for the skill by name and include a location plus cutoff date.

Examples:

- `Use the google-earth-crop skill to get an image for "1150 Amsterdam Ave, New York, NY 10027" before 2025-01-01.`
- `Use google-earth-crop to capture "1150 Amsterdam Ave, New York, NY 10027" before 2025-01-01, 2024-01-01, and 2023-01-01.`
- `Use google-earth-crop for coordinates "45.6273,-122.6716" before 2020-01-01 and save the output under crops/vancouver-wa/`.
- `Use google-earth-crop to batch crop this CSV. It already has lat, lon, query_date, and output_name columns.`
- `Use google-earth-crop to batch crop this CSV. It has address, query_date, and output_name columns.`
- `Run the google-earth-crop benchmark/eval.`

Cutoff dates are exclusive: asking for imagery before `2025-01-01` targets `2024-12-31`.

## What You Get

Each crop writes:

```text
<output-name>.png
<output-name>.json
```

The JSON sidecar is intentionally small and flat: `address`, `addressKey`, `dateUsed`, `cutoffDate`, `location`, `outputPath`, `zoomLevel`, `googleEarthQueryUrl`, and `imageDateOcr`.
The PNG includes a centered red dot at the queried location by default, appends the visible Google Earth bottom date/status strip below the crop for manual inspection, and overlays `Image date: ...` at top left when OCR finds a visible Google Earth image date. Qualifiers such as `older` are accepted during OCR parsing but are not included in the overlay or JSON date value.

## Setup Notes

The skill normally uses local headless Playwright and will try to install missing dependencies automatically from this skill directory. For manual setup:

```bash
cd .agents/skills/google-earth-crop
npm run install:playwright
```

Requirements: Node.js 18+, npm, and network access to Google Earth Web.

## CSV Batches

The deterministic batch runner expects normalized CSV input with `query_date`, `output_name`, and one location source: either `lat`+`lon` or `address`:

```bash
npm run crop:csv -- --csv normalized.csv --output crops/batch
```

If your CSV has different headers, addresses, multiple dates, or custom date rules, the agent should first copy `assets/templates/normalize_csv.template.mjs` to `/tmp`, customize it, generate a normalized CSV, inspect it with `--dry-run`, and then run `scripts/crop_csv_batch.mjs`.

The crop engine OCRs the already-visible bottom date/status strip before opening historical imagery controls, because menu toggles can hide or change the visible date. When a batch crop succeeds but the visible date OCR fails, the deterministic runner retries from a fresh browser context by default (`--missing-ocr-retry-mode fresh-context`). This is slower than the old same-page retry, but it gives Google Earth a clean screen state before giving up; use `--missing-ocr-retry-mode same-page` only for lightweight diagnostics.

## Eval

Prompt: `Run the google-earth-crop benchmark/eval.`

A passing run should report `total: 10`, `ok: 10`, `failed: 0`, and no splash, blank, or low-detail detections. Benchmark artifacts are written under `benchmark-runs/` and are ignored by git. The coordinate CSV batch smoke test uses `npm run eval:csv`; the address CSV batch smoke test uses `npm run eval:csv:address`; the Moorpark date-only OCR regression uses `npm run eval:moorpark`; the Mackinnon conditional date-probe regression uses `npm run eval:mackinnon`.

For a fast source check without launching Google Earth, run `npm run check` from the skill directory.

## Troubleshooting

- If a crop looks blurry or like a loading screen, ask the agent to retry; the normal retry path can click older image, then newer image, then additional older images to refresh Google Earth's tiles while keeping the accepted timeline date before the cutoff.
- If you need wider context, ask the agent to use a larger preferred camera altitude.
- If a custom crop does not show the red dot or the dot is off-center, make sure the clip is centered on the viewport center or ask for the default square clip.
- If a coordinate crop points to the wrong place, inspect `batch-summary.json` or `benchmark-summary.json` for `targetDelta`, camera, and validation metadata; per-image sidecars intentionally stay compact.
- Add `headed` or ask for visual debugging only when headless rendering is hard to diagnose.
- Generated `node_modules/`, `benchmark-runs/`, and `crops/` directories are intentionally ignored.