#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CUTOFF_DATE,
  DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE,
  DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_MIN_DETAIL_SCORE,
  DEFAULT_PREFERRED_CAMERA_ALTITUDE,
  DEFAULT_RENDER_SETTLE_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM_LEVEL,
  buildSummary,
  cameraRangeForZoomLevel,
  cropGoogleEarth,
  isPassingSummary,
  launchChromium,
  loadChromium,
  optionFlag,
  optionValue,
  parseClip,
  targetDateFor
} from './google_earth_crop_core.mjs';

const outputDir = path.resolve(optionValue('output') ?? 'benchmark-runs/us-10-coordinate');
const imageDir = path.join(outputDir, 'images');
const cutoffDate = optionValue('cutoff') ?? DEFAULT_CUTOFF_DATE;
const targetDate = targetDateFor(cutoffDate);
const renderSettleMs = Number(optionValue('render-settle-ms') ?? DEFAULT_RENDER_SETTLE_MS);
const explicitPreferredAltitude = optionValue('preferred-camera-altitude') ?? optionValue('max-camera-altitude');
const zoomLevel = optionValue('zoom-level') ? Number(optionValue('zoom-level')) : (explicitPreferredAltitude ? null : DEFAULT_ZOOM_LEVEL);
const zoomCameraRange = cameraRangeForZoomLevel(zoomLevel);
const intermediateFallbackCameraAltitude = Number(optionValue('intermediate-fallback-camera-altitude') ?? DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE);
const largeFallbackCameraAltitude = Number(optionValue('large-fallback-camera-altitude') ?? DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE);
const minDetailScore = Number(optionValue('min-detail-score') ?? (zoomLevel && zoomLevel >= DEFAULT_ZOOM_LEVEL ? 40 : DEFAULT_MIN_DETAIL_SCORE));
const preferredCameraAltitude = Number(explicitPreferredAltitude ?? zoomCameraRange ?? DEFAULT_PREFERRED_CAMERA_ALTITUDE);
const markLocation = !optionFlag('no-marker');
const markerRadius = Number(optionValue('marker-radius') ?? DEFAULT_MARKER_RADIUS);
const includeDateLabel = !optionFlag('no-date-label');
const strictCameraAltitude = Boolean(zoomLevel) && optionFlag('strict-zoom');
const viewport = DEFAULT_VIEWPORT;
const clip = parseClip(optionValue('clip'));
const benchmarkLocations = [
  { index: 1, label: 'vancouver-wa', query: '45.6273,-122.6716' },
  { index: 2, label: 'little-rock-ar', query: '34.7465,-92.2896' },
  { index: 3, label: 'tallahassee-fl', query: '30.4515,-84.2727' },
  { index: 4, label: 'boise-id', query: '43.6150,-116.2023' },
  { index: 5, label: 'las-vegas-nv', query: '36.1539,-115.1522' },
  { index: 6, label: 'cheyenne-wy', query: '41.1400,-104.8202' },
  { index: 7, label: 'dallas-tx', query: '32.7767,-96.7970' },
  { index: 8, label: 'cincinnati-oh', query: '39.1031,-84.5120' },
  { index: 9, label: 'fargo-nd', query: '46.8772,-96.7898' },
  { index: 10, label: 'atlanta-ga', query: '33.7490,-84.3880' }
];
const limit = Number(optionValue('limit') ?? benchmarkLocations.length);
const locations = benchmarkLocations.slice(0, Number.isFinite(limit) && limit > 0 ? Math.min(limit, benchmarkLocations.length) : benchmarkLocations.length);

await fs.mkdir(imageDir, { recursive: true });

const chromium = await loadChromium();
const browser = await launchChromium(chromium, { headed: optionFlag('headed') });
const context = await browser.newContext({ viewport });
const page = await context.newPage();
page.setDefaultTimeout(20000);

const perLocation = [];
let lastConfirmedCamera = null;

try {
  for (const location of locations) {
    const outputPath = path.join(imageDir, `${String(location.index).padStart(2, '0')}-${location.label}.png`);
    const result = await cropGoogleEarth(page, {
      location: location.query,
      outputPath,
      cutoffDate,
      renderSettleMs,
      minDetailScore,
      preferredCameraAltitude,
      zoomLevel,
      intermediateFallbackCameraAltitude,
      largeFallbackCameraAltitude,
      markLocation,
      markerRadius,
      includeDateLabel,
      strictCameraAltitude,
      clip,
      previousCamera: lastConfirmedCamera,
      index: location.index,
      label: location.label
    });

    perLocation.push(result);
    if (result.status === 'ok') lastConfirmedCamera = result.camera;
    console.log(`${result.status.toUpperCase()} ${perLocation.length}/${locations.length} ${location.label} ${result.totalMs}ms`);
  }
} finally {
  await browser.close();
}

const summary = buildSummary(perLocation);
const report = {
  date: new Date().toISOString(),
  cutoffDate,
  targetDate,
  zoomLevel,
  zoomCameraRange,
  zoomCameraRangeCandidates: perLocation[0]?.zoomCameraRangeCandidates ?? null,
  intermediateFallbackCameraAltitude,
  largeFallbackCameraAltitude,
  renderSettleMs,
  minDetailScore,
  preferredCameraAltitude,
  markLocation,
  markerRadius,
  includeDateLabel,
  strictCameraAltitude,
  viewport,
  clip,
  locations: locations.map((location) => location.query),
  totalBenchmarkLocations: benchmarkLocations.length,
  results: summary,
  perLocation
};

await fs.writeFile(path.join(outputDir, 'benchmark-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
const markersOk = !markLocation || (summary.markerDrawn === locations.length && summary.markerCentered === locations.length);
const dateLabelsOk = !includeDateLabel || summary.dateLabelIncluded === locations.length;
const strictCameraAltitudeOk = !strictCameraAltitude || summary.strictCameraAltitudeMatched === locations.length;
process.exit(isPassingSummary(summary) && summary.total === locations.length && markersOk && dateLabelsOk && strictCameraAltitudeOk ? 0 : 1);