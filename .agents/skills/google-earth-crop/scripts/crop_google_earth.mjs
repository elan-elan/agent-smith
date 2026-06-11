#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CLIP,
  DEFAULT_CUTOFF_DATE,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_MIN_DETAIL_SCORE,
  DEFAULT_PREFERRED_CAMERA_ALTITUDE,
  DEFAULT_RENDER_SETTLE_MS,
  DEFAULT_VIEWPORT,
  cropGoogleEarth,
  labelForLocation,
  launchChromium,
  loadChromium,
  optionFlag,
  optionValue,
  parseClip,
  targetDateFor
} from './google_earth_crop_core.mjs';

const location = optionValue('location') ?? optionValue('loc') ?? positionalLocation();
const cutoffDate = optionValue('cutoff') ?? DEFAULT_CUTOFF_DATE;
const targetDate = targetDateFor(cutoffDate);
const outputPath = path.resolve(optionValue('output') ?? optionValue('out') ?? path.join('crops', `${labelForLocation(location ?? 'crop')}-${targetDate}.png`));
const summaryPath = optionFlag('no-summary') ? null : path.resolve(optionValue('summary') ?? defaultSummaryPath(outputPath));
const renderSettleMs = Number(optionValue('render-settle-ms') ?? DEFAULT_RENDER_SETTLE_MS);
const minDetailScore = Number(optionValue('min-detail-score') ?? DEFAULT_MIN_DETAIL_SCORE);
const preferredCameraAltitude = Number(optionValue('preferred-camera-altitude') ?? optionValue('max-camera-altitude') ?? DEFAULT_PREFERRED_CAMERA_ALTITUDE);
const markLocation = !optionFlag('no-marker');
const markerRadius = Number(optionValue('marker-radius') ?? DEFAULT_MARKER_RADIUS);
const clip = parseClip(optionValue('clip'));

if (!location || optionFlag('help')) {
  printUsage();
  process.exit(location ? 0 : 1);
}

const chromium = await loadChromium();
const browser = await launchChromium(chromium, { headed: optionFlag('headed') });
let report;

try {
  const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  const result = await cropGoogleEarth(page, {
    location,
    outputPath,
    cutoffDate,
    renderSettleMs,
    minDetailScore,
    preferredCameraAltitude,
    markLocation,
    markerRadius,
    clip
  });

  report = {
    date: new Date().toISOString(),
    cutoffDate,
    targetDate,
    renderSettleMs,
    minDetailScore,
    preferredCameraAltitude,
    markLocation,
    markerRadius,
    viewport: DEFAULT_VIEWPORT,
    clip,
    result
  };
} finally {
  await browser.close();
}

if (summaryPath) {
  report.summaryPath = summaryPath;
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });
  await fs.writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.result.status === 'ok' ? 0 : 1);

function positionalLocation() {
  const args = process.argv.slice(2);
  const optionsWithValues = new Set(['--location', '--loc', '--cutoff', '--output', '--out', '--summary', '--clip', '--render-settle-ms', '--min-detail-score', '--preferred-camera-altitude', '--max-camera-altitude', '--marker-radius']);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (optionsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (!arg.startsWith('--')) return arg;
  }
  return null;
}

function defaultSummaryPath(imagePath) {
  const extension = path.extname(imagePath);
  if (!extension) return `${imagePath}.json`;
  return imagePath.slice(0, -extension.length) + '.json';
}

function printUsage() {
  console.error(`Usage: node scripts/crop_google_earth.mjs --location "45.6273,-122.6716" --cutoff 2020-01-01 --output crops/vancouver-wa.png

Options:
  --location, --loc       Place name or lat,lon. The first positional arg also works.
  --cutoff               Cutoff date, YYYY-MM-DD. Default: ${DEFAULT_CUTOFF_DATE}
  --output, --out         PNG output path. Default: crops/<location>-<target-date>.png
  --summary              JSON report path. Default: output path with .json extension.
  --no-summary           Do not write a JSON report.
  --clip                 Crop rectangle as x,y,width,height. Default: ${DEFAULT_CLIP.x},${DEFAULT_CLIP.y},${DEFAULT_CLIP.width},${DEFAULT_CLIP.height}
  --render-settle-ms     Wait after date validation. Default: ${DEFAULT_RENDER_SETTLE_MS}
  --min-detail-score     Low-detail rejection threshold. Default: ${DEFAULT_MIN_DETAIL_SCORE}
  --preferred-camera-altitude  Preferred close camera altitude in meters; falls back wider if needed. Default: ${DEFAULT_PREFERRED_CAMERA_ALTITUDE}
  --max-camera-altitude        Legacy alias for --preferred-camera-altitude.
  --marker-radius        Red location marker radius in pixels. Default: ${DEFAULT_MARKER_RADIUS}
  --no-marker            Save the crop without the red location marker.
  --headed               Show Chromium for debugging.
`);
}