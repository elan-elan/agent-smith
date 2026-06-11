# Google Earth Crop

Human-facing guide for prompting the `google-earth-crop` skill. Agent instructions live in `SKILL.md`.

This skill captures Google Earth Web crops for places or coordinates, including historical imagery at the newest timeline date before a cutoff date. It saves a marked PNG plus a JSON sidecar with the selected date, camera, red-dot marker metadata, output path, timing, and image-quality checks.

Default framing is a centered square neighborhood crop around the target, usually a few buildings rather than a city-scale map. If close historical imagery is blank or low-detail, the skill widens the camera until the crop passes image checks.

## How To Prompt It

Ask for the skill by name and include a location plus cutoff date.

Examples:

- `Use the google-earth-crop skill to get an image for "1150 Amsterdam Ave, New York, NY 10027" before 2025-01-01.`
- `Use google-earth-crop to capture "1150 Amsterdam Ave, New York, NY 10027" before 2025-01-01, 2024-01-01, and 2023-01-01.`
- `Use google-earth-crop for coordinates "45.6273,-122.6716" before 2020-01-01 and save the output under crops/vancouver-wa/`.
- `Run the google-earth-crop benchmark/eval.`

Cutoff dates are exclusive: asking for imagery before `2025-01-01` targets `2024-12-31`.

## What You Get

Each crop writes:

```text
<output-name>.png
<output-name>.json
```

The JSON sidecar is useful for checking the actual selected date, camera, crop geometry, marker position, status, and whether the image passed splash/blank/low-detail validation.
The PNG includes a centered red dot at the queried location by default.

## Setup Notes

The skill normally uses local headless Playwright and will try to install missing dependencies automatically from this skill directory. For manual setup:

```bash
cd .agents/skills/google-earth-crop
npm run install:playwright
```

Requirements: Node.js 18+, npm, and network access to Google Earth Web.

## Benchmark

Prompt: `Run the google-earth-crop benchmark/eval.`

A passing run should report `total: 10`, `ok: 10`, `failed: 0`, and no splash, blank, or low-detail detections. Benchmark artifacts are written under `benchmark-runs/` and are ignored by git.

For a fast source check without launching Google Earth, run `npm run check` from the skill directory.

## Troubleshooting

- If a crop looks blurry or like a loading screen, ask the agent to retry with more render settle time.
- If you need wider context, ask the agent to use a larger preferred camera altitude.
- If a custom crop does not show the red dot or the dot is off-center, make sure the clip is centered on the viewport center or ask for the default square clip.
- If a coordinate crop points to the wrong place, inspect `targetDelta`, `camera`, and `selectedDate` in the JSON sidecar.
- Add `headed` or ask for visual debugging only when headless rendering is hard to diagnose.
- Generated `node_modules/`, `benchmark-runs/`, and `crops/` directories are intentionally ignored.