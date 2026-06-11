#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CUTOFF_DATE,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_MIN_DETAIL_SCORE,
  DEFAULT_PREFERRED_CAMERA_ALTITUDE,
  DEFAULT_RENDER_SETTLE_MS,
  DEFAULT_VIEWPORT,
  buildSummary,
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
const minDetailScore = Number(optionValue('min-detail-score') ?? DEFAULT_MIN_DETAIL_SCORE);
const preferredCameraAltitude = Number(optionValue('preferred-camera-altitude') ?? optionValue('max-camera-altitude') ?? DEFAULT_PREFERRED_CAMERA_ALTITUDE);
const markLocation = !optionFlag('no-marker');
const markerRadius = Number(optionValue('marker-radius') ?? DEFAULT_MARKER_RADIUS);
const viewport = DEFAULT_VIEWPORT;
const clip = parseClip(optionValue('clip'));
const locations = [
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
      markLocation,
      markerRadius,
      clip,
      previousCamera: lastConfirmedCamera,
      index: location.index,
      label: location.label
    });

    perLocation.push(result);
    if (result.status === 'ok') lastConfirmedCamera = result.camera;
    console.log(`${result.status.toUpperCase()} ${location.index}/10 ${location.label} ${result.totalMs}ms`);
  }
} finally {
  await browser.close();
}

const summary = buildSummary(perLocation);
const report = {
  date: new Date().toISOString(),
  cutoffDate,
  targetDate,
  renderSettleMs,
  minDetailScore,
  preferredCameraAltitude,
  markLocation,
  markerRadius,
  viewport,
  clip,
  locations: locations.map((location) => location.query),
  results: summary,
  perLocation
};

await fs.writeFile(path.join(outputDir, 'benchmark-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
const markersOk = !markLocation || (summary.markerDrawn === locations.length && summary.markerCentered === locations.length);
process.exit(isPassingSummary(summary) && summary.total === locations.length && markersOk ? 0 : 1);