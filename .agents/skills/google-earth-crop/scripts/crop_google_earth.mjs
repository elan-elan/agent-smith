#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CLIP,
  DEFAULT_CUTOFF_DATE,
  DEFAULT_EXTRACT_IMAGERY_DATE,
  DEFAULT_INCLUDE_DATE_LABEL,
  DEFAULT_IMAGERY_DATE_OCR_RETRIES,
  DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS,
  DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE,
  DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_MIN_CENTER_SHARPNESS_SCORE,
  DEFAULT_MIN_DETAIL_SCORE,
  DEFAULT_PREFERRED_CAMERA_ALTITUDE,
  DEFAULT_ROOF_ZOOM_LEVEL,
  DEFAULT_RENDER_SETTLE_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM_LEVEL,
  cameraRangeForZoomLevel,
  cropGoogleEarth,
  googleEarthQueryUrl,
  labelForLocation,
  launchChromium,
  loadChromium,
  optionFlag,
  optionValue,
  parseClip,
  targetDateFor,
  terminateImageryDateOcrWorker
} from './google_earth_crop_core.mjs';

const location = optionValue('location') ?? optionValue('loc') ?? positionalLocation();
const cutoffDate = optionValue('cutoff') ?? DEFAULT_CUTOFF_DATE;
const targetDate = targetDateFor(cutoffDate);
const outputPath = path.resolve(optionValue('output') ?? optionValue('out') ?? path.join('crops', `${labelForLocation(location ?? 'crop')}-${targetDate}.png`));
const summaryPath = optionFlag('no-summary') ? null : path.resolve(optionValue('summary') ?? defaultSummaryPath(outputPath));
const renderSettleMs = Number(optionValue('render-settle-ms') ?? DEFAULT_RENDER_SETTLE_MS);
const explicitPreferredAltitude = optionValue('preferred-camera-altitude') ?? optionValue('max-camera-altitude');
const zoomLevel = optionValue('zoom-level') ? Number(optionValue('zoom-level')) : (explicitPreferredAltitude ? null : DEFAULT_ZOOM_LEVEL);
const zoomCameraRange = cameraRangeForZoomLevel(zoomLevel);
const intermediateFallbackCameraAltitude = Number(optionValue('intermediate-fallback-camera-altitude') ?? DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE);
const largeFallbackCameraAltitude = Number(optionValue('large-fallback-camera-altitude') ?? DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE);
const minDetailScore = Number(optionValue('min-detail-score') ?? (zoomLevel && zoomLevel >= DEFAULT_ZOOM_LEVEL ? 40 : DEFAULT_MIN_DETAIL_SCORE));
const minCenterSharpnessScore = Number(optionValue('min-center-sharpness-score') ?? DEFAULT_MIN_CENTER_SHARPNESS_SCORE);
const preferredCameraAltitude = Number(explicitPreferredAltitude ?? zoomCameraRange ?? DEFAULT_PREFERRED_CAMERA_ALTITUDE);
const markLocation = !optionFlag('no-marker');
const markerRadius = Number(optionValue('marker-radius') ?? DEFAULT_MARKER_RADIUS);
const includeDateLabel = !optionFlag('no-date-label');
const extractImageryDate = includeDateLabel && !optionFlag('no-date-ocr') && DEFAULT_EXTRACT_IMAGERY_DATE;
const imageryDateOcrRetries = Number(optionValue('date-ocr-retries') ?? DEFAULT_IMAGERY_DATE_OCR_RETRIES);
const imageryDateOcrRetryWaitMs = Number(optionValue('date-ocr-retry-wait-ms') ?? DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS);
const matchRequestedZoomExtent = optionFlag('match-requested-zoom-extent');
const clip = parseClip(optionValue('clip'));

if (!location || optionFlag('help')) {
  printUsage();
  process.exit(optionFlag('help') ? 0 : 1);
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
    minCenterSharpnessScore,
    preferredCameraAltitude,
    zoomLevel,
    intermediateFallbackCameraAltitude,
    largeFallbackCameraAltitude,
    markLocation,
    markerRadius,
    includeDateLabel,
    extractImageryDate,
    imageryDateOcrRetries,
    imageryDateOcrRetryWaitMs,
    matchRequestedZoomExtent,
    clip
  });

  report = {
    date: new Date().toISOString(),
    cutoffDate,
    targetDate,
    zoomLevel,
    zoomCameraRange,
    zoomCameraRangeCandidates: result.zoomCameraRangeCandidates ?? null,
    intermediateFallbackCameraAltitude,
    largeFallbackCameraAltitude,
    renderSettleMs,
    minDetailScore,
    minCenterSharpnessScore,
    preferredCameraAltitude,
    markLocation,
    markerRadius,
    includeDateLabel,
    extractImageryDate,
    imageryDateOcrRetries,
    imageryDateOcrRetryWaitMs,
    matchRequestedZoomExtent,
    viewport: DEFAULT_VIEWPORT,
    clip,
    result
  };
} finally {
  await browser.close();
  await terminateImageryDateOcrWorker();
}

if (summaryPath) {
  const manifest = compactCropManifest(report, summaryPath);
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });
  await fs.writeFile(summaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(JSON.stringify(compactCropManifest(report, summaryPath), null, 2));
process.exit(report.result.status === 'ok' ? 0 : 1);

function compactCropManifest(cropReport, jsonPath) {
  const { result } = cropReport;
  const manifest = {
    address: result.query,
    addressKey: null,
    dateUsed: result.selectedDate ?? cropReport.targetDate,
    cutoffDate: cropReport.cutoffDate,
    location: result.query,
    outputPath: result.outputPath,
    zoomLevel: result.finalZoomLevel ?? cropReport.zoomLevel ?? null,
    googleEarthQueryUrl: googleEarthQueryUrl(result.query),
    imageDateOcr: result.dateLabel?.ocr?.imageryDate ?? null
  };
  if (result.status !== 'ok') manifest.error = result.error;
  return JSON.parse(JSON.stringify(manifest));
}

function positionalLocation() {
  const args = process.argv.slice(2);
  const optionsWithValues = new Set(['--location', '--loc', '--cutoff', '--output', '--out', '--summary', '--clip', '--zoom-level', '--intermediate-fallback-camera-altitude', '--large-fallback-camera-altitude', '--render-settle-ms', '--min-detail-score', '--min-center-sharpness-score', '--preferred-camera-altitude', '--max-camera-altitude', '--marker-radius', '--date-ocr-retries', '--date-ocr-retry-wait-ms']);
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
  --zoom-level           Approximate web-map zoom level. Default: ${DEFAULT_ZOOM_LEVEL}. Falls back through zoom 18, then 1000m with one retry, then 1500m.
  --intermediate-fallback-camera-altitude  Recovery range in meters before the final large fallback. Default: ${DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE}
  --large-fallback-camera-altitude  Final recovery range in meters after zoom fallbacks fail. Default: ${DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE}
  --render-settle-ms     Wait after date validation. Default: ${DEFAULT_RENDER_SETTLE_MS}
  --min-detail-score     Low-detail rejection threshold. Default: ${DEFAULT_MIN_DETAIL_SCORE}
  --min-center-sharpness-score  Center-crop blur rejection threshold. Default: ${DEFAULT_MIN_CENTER_SHARPNESS_SCORE}
  --preferred-camera-altitude  Preferred close camera altitude in meters; falls back wider if needed. Default: ${DEFAULT_PREFERRED_CAMERA_ALTITUDE}
  --max-camera-altitude        Legacy alias for --preferred-camera-altitude.
  --marker-radius        Red location marker radius in pixels. Default: ${DEFAULT_MARKER_RADIUS}
  --no-marker            Save the crop without the red location marker.
  --no-date-label        Do not capture, append, OCR, or overlay the visible Google Earth imagery date/status strip. Default: ${DEFAULT_INCLUDE_DATE_LABEL ? 'append strip, OCR, and overlay date when parsed' : 'skip date label'}.
  --no-date-ocr          Append the date/status strip but skip OCR, which also disables the image-date text overlay. Default: ${DEFAULT_EXTRACT_IMAGERY_DATE ? 'OCR strip' : 'skip OCR'}.
  --date-ocr-retries     Retry bottom-strip screenshot+OCR when no date is parsed. Default: ${DEFAULT_IMAGERY_DATE_OCR_RETRIES}
  --date-ocr-retry-wait-ms  Wait between OCR retry screenshots. Default: ${DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS}
  --match-requested-zoom-extent  If a lower zoom-level fallback succeeds, center-crop it to match the requested zoom extent and resize back before overlays.
  --headed               Show Chromium for debugging.
`);
}