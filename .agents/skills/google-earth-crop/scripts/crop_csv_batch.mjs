#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_EXTRACT_IMAGERY_DATE,
  DEFAULT_IMAGERY_DATE_OCR_RETRIES,
  DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS,
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
  googleEarthQueryUrl,
  launchChromium,
  loadChromium,
  parseClip,
  targetDateFor,
  terminateImageryDateOcrWorker
} from './google_earth_crop_core.mjs';

const COMMON_REQUIRED_COLUMNS = ['query_date', 'output_name'];
const COORDINATE_LOCATION_COLUMNS = ['lat', 'lon'];
const ADDRESS_LOCATION_COLUMNS = ['address', 'full_address', 'site_address', 'location', 'query'];

const csvOption = cliOptionValue('csv');
const outputOption = cliOptionValue('output');
const rowLimit = parseOptionalPositiveInteger(cliOptionValue('limit'), '--limit');
const cropRetries = Number(cliOptionValue('crop-retries') ?? 1);
const missingOcrRetries = Number(cliOptionValue('missing-ocr-retries') ?? 1);
const renderSettleMs = Number(cliOptionValue('render-settle-ms') ?? DEFAULT_RENDER_SETTLE_MS);
const explicitPreferredAltitude = cliOptionValue('preferred-camera-altitude') ?? cliOptionValue('max-camera-altitude');
const zoomLevel = cliOptionValue('zoom-level') ? Number(cliOptionValue('zoom-level')) : (explicitPreferredAltitude ? null : DEFAULT_ZOOM_LEVEL);
const zoomCameraRange = cameraRangeForZoomLevel(zoomLevel);
const intermediateFallbackCameraAltitude = Number(cliOptionValue('intermediate-fallback-camera-altitude') ?? DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE);
const largeFallbackCameraAltitude = Number(cliOptionValue('large-fallback-camera-altitude') ?? DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE);
const minDetailScore = Number(cliOptionValue('min-detail-score') ?? (zoomLevel && zoomLevel >= DEFAULT_ZOOM_LEVEL ? 40 : DEFAULT_MIN_DETAIL_SCORE));
const preferredCameraAltitude = Number(explicitPreferredAltitude ?? zoomCameraRange ?? DEFAULT_PREFERRED_CAMERA_ALTITUDE);
const markLocation = !cliFlag('no-marker');
const markerRadius = Number(cliOptionValue('marker-radius') ?? DEFAULT_MARKER_RADIUS);
const includeDateLabel = !cliFlag('no-date-label');
const extractImageryDate = includeDateLabel && !cliFlag('no-date-ocr') && DEFAULT_EXTRACT_IMAGERY_DATE;
const imageryDateOcrRetries = Number(cliOptionValue('date-ocr-retries') ?? DEFAULT_IMAGERY_DATE_OCR_RETRIES);
const imageryDateOcrRetryWaitMs = Number(cliOptionValue('date-ocr-retry-wait-ms') ?? DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS);
const viewport = DEFAULT_VIEWPORT;
const clip = parseClip(cliOptionValue('clip'));

if (cliFlag('help')) {
  printUsage();
  process.exit(0);
}

if (csvOption == null) throw new Error('--csv is required');
if (outputOption == null) throw new Error('--output is required');
if (!Number.isFinite(cropRetries) || cropRetries < 0) throw new Error('--crop-retries must be zero or greater');
if (!Number.isFinite(missingOcrRetries) || missingOcrRetries < 0) throw new Error('--missing-ocr-retries must be zero or greater');

const csvPath = path.resolve(csvOption);
const outputDir = path.resolve(outputOption);
const csvText = await fs.readFile(csvPath, 'utf8');
const records = parseCsv(csvText).filter((record) => record.some((cell) => cell.trim()));
if (records.length < 2) throw new Error('CSV must contain a header and at least one data row');

const headers = records[0].map((header) => header.trim());
validateRequiredHeaders(headers);
const rawRows = records.slice(1).map((record, recordIndex) => ({
  sourceLine: recordIndex + 2,
  raw: Object.fromEntries(headers.map((header, headerIndex) => [header, record[headerIndex] ?? '']))
}));

const rawRowsToPlan = rowLimit === null ? rawRows : rawRows.slice(0, rowLimit);
const plannedRows = selectRows(rawRowsToPlan.map(planRow));
const plannedCropCount = plannedRows.length;

if (cliFlag('dry-run')) {
  console.log(JSON.stringify({
    csvPath,
    outputDir,
    requiredColumns: COMMON_REQUIRED_COLUMNS,
    locationColumnSets: [COORDINATE_LOCATION_COLUMNS, ['address']],
    rowLimit,
    parsedRows: rawRows.length,
    rowsToProcess: plannedRows.length,
    plannedCropCount,
    rows: plannedRows.map(rowForSummary)
  }, null, 2));
  process.exit(0);
}

await fs.mkdir(outputDir, { recursive: true });

const chromium = await loadChromium();
const browser = await launchChromium(chromium, { headed: cliFlag('headed') });
const context = await browser.newContext({ viewport });
const page = await context.newPage();
page.setDefaultTimeout(20000);

const perCrop = [];
const perLocation = [];
let lastConfirmedCamera = null;
let lastConfirmedLocation = null;

try {
  for (const [rowIndex, row] of plannedRows.entries()) {
    const baseLabel = row.outputName;
    const temporaryOutputPath = path.join(outputDir, `.tmp-${process.pid}-${rowIndex + 1}-${baseLabel}.png`);
    const previousCameraForReadiness = row.locationKind === 'address' && row.location === lastConfirmedLocation
      ? null
      : lastConfirmedCamera;
    const result = await cropWithRetries(page, {
      location: row.location,
      outputPath: temporaryOutputPath,
      cutoffDate: row.queryDate,
      renderSettleMs,
      minDetailScore,
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
      clip,
      previousCamera: previousCameraForReadiness,
      index: rowIndex + 1,
      label: baseLabel
    }, { cropRetries, missingOcrRetries });

    const finalOutputPath = path.join(outputDir, `${baseLabel}.png`);
    const jsonPath = defaultSummaryPath(finalOutputPath);
    if (result.status === 'ok') {
      await fs.rm(finalOutputPath, { force: true });
      await fs.rename(temporaryOutputPath, finalOutputPath);
    } else {
      await fs.rm(temporaryOutputPath, { force: true });
    }
    result.outputPath = finalOutputPath;

    if (result.status === 'ok') {
      lastConfirmedCamera = result.camera;
      lastConfirmedLocation = row.location;
    }
    perCrop.push(result);

    const manifest = compactCropManifest({ row, result });
    await fs.writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
    perLocation.push({ rowIndex: rowIndex + 1, row: rowForSummary(row), outputPath: finalOutputPath, jsonPath, status: result.status });
    console.log(`${result.status.toUpperCase()} ${rowIndex + 1}/${plannedCropCount} ${path.basename(finalOutputPath)} cutoff=${row.queryDate} selected=${result.selectedDate ?? 'none'} ${result.totalMs}ms`);
  }
} finally {
  await browser.close();
  await terminateImageryDateOcrWorker();
}

const summary = buildSummary(perCrop);
const batchReport = {
  date: new Date().toISOString(),
  csvPath,
  outputDir,
  requiredColumns: COMMON_REQUIRED_COLUMNS,
  locationColumnSets: [COORDINATE_LOCATION_COLUMNS, ['address']],
  rowLimit,
  parsedRows: rawRows.length,
  rowsToProcess: plannedRows.length,
  plannedCropCount,
  zoomLevel,
  zoomCameraRange,
  zoomCameraRangeCandidates: perCrop[0]?.zoomCameraRangeCandidates ?? null,
  intermediateFallbackCameraAltitude,
  largeFallbackCameraAltitude,
  renderSettleMs,
  minDetailScore,
  preferredCameraAltitude,
  markLocation,
  markerRadius,
  includeDateLabel,
  extractImageryDate,
  imageryDateOcrRetries,
  imageryDateOcrRetryWaitMs,
  viewport,
  clip,
  results: summary,
  rows: plannedRows.map(rowForSummary),
  perLocation,
  perCrop
};

await fs.writeFile(path.join(outputDir, 'batch-summary.json'), `${JSON.stringify(batchReport, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.failed === 0 && summary.total === plannedCropCount ? 0 : 1);

function validateRequiredHeaders(headersToValidate) {
  const missing = COMMON_REQUIRED_COLUMNS.filter((column) => !headersToValidate.includes(column));
  if (missing.length) {
    throw new Error(`CSV must include required columns: ${COMMON_REQUIRED_COLUMNS.join(', ')}. Missing: ${missing.join(', ')}. Use assets/templates/normalize_csv.template.mjs to convert custom CSVs first.`);
  }

  const hasCoordinateHeaders = COORDINATE_LOCATION_COLUMNS.every((column) => headersToValidate.includes(column));
  const hasAddressHeader = ADDRESS_LOCATION_COLUMNS.some((column) => headersToValidate.includes(column));
  if (!hasCoordinateHeaders && !hasAddressHeader) {
    throw new Error('CSV must include a location source: either lat and lon columns, or an address column. Use assets/templates/normalize_csv.template.mjs to convert custom CSVs first.');
  }
}

function planRow({ raw, sourceLine }) {
  const queryDate = parseIsoDate(raw.query_date, 'query_date', sourceLine);
  const outputName = normalizeOutputName(raw.output_name, sourceLine);
  const address = firstPresent(raw, ADDRESS_LOCATION_COLUMNS) ?? null;
  const addressKey = firstPresent(raw, ['address_key', 'id', 'parcel_id', 'property_id']) ?? null;
  const hasLat = hasText(raw.lat);
  const hasLon = hasText(raw.lon);
  let lat = null;
  let lon = null;
  let location = null;
  let locationKind = null;

  if (hasLat || hasLon) {
    if (!hasLat || !hasLon) throw new Error(`row ${sourceLine} must include both lat and lon, or use address without partial coordinates`);
    lat = parseCoordinate(raw.lat, 'lat', sourceLine, -90, 90);
    lon = parseCoordinate(raw.lon, 'lon', sourceLine, -180, 180);
    location = `${formatCoordinate(lat)},${formatCoordinate(lon)}`;
    locationKind = 'coordinates';
  } else if (address) {
    location = address;
    locationKind = 'address';
  } else {
    throw new Error(`row ${sourceLine} must include either lat/lon or address`);
  }

  return {
    sourceLine,
    raw,
    lat,
    lon,
    queryDate,
    outputName,
    address,
    addressKey,
    location,
    locationKind,
    crops: [{ outputName, cutoffDate: queryDate, cutoffRule: 'query_date' }]
  };
}

async function cropWithRetries(page, cropOptions, { cropRetries: retries, missingOcrRetries: ocrRetries }) {
  let finalResult = null;
  const maxAttempts = Math.max(retries, ocrRetries) + 1;
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    const result = await cropGoogleEarth(page, cropOptions);
    result.batchAttempt = attemptIndex + 1;
    finalResult = result;
    const canRetryError = result.status !== 'ok' && attemptIndex < retries;
    const canRetryMissingOcr = result.status === 'ok'
      && cropOptions.extractImageryDate
      && !isPlausibleOcrDate(result.dateLabel?.ocr?.imageryDate)
      && attemptIndex < ocrRetries;
    if (!canRetryError && !canRetryMissingOcr) return result;
    if (canRetryMissingOcr) {
      console.warn(`RETRY ${cropOptions.label} attempt=${attemptIndex + 2} previous=missing-or-implausible image date`);
    } else {
      console.warn(`RETRY ${cropOptions.label} attempt=${attemptIndex + 2} previous=${String(result.error || 'unknown').slice(0, 160)}`);
    }
    await page.waitForTimeout(1500);
  }
  return finalResult;
}

function compactCropManifest({ row, result }) {
  return JSON.parse(JSON.stringify({
    address: row.address,
    addressKey: row.addressKey,
    dateUsed: result.selectedDate ?? targetDateFor(row.queryDate),
    cutoffDate: row.queryDate,
    location: result.query,
    outputPath: result.outputPath,
    zoomLevel: result.finalZoomLevel ?? zoomLevel ?? null,
    googleEarthQueryUrl: googleEarthQueryUrl(result.query),
    imageDateOcr: result.dateLabel?.ocr?.imageryDate ?? null,
    error: result.status === 'ok' ? undefined : result.error,
    status: result.status === 'ok' ? undefined : result.status
  }));
}

function parseCsv(csvText) {
  const records = [];
  let record = [];
  let cell = '';
  let inQuotes = false;

  for (let characterIndex = 0; characterIndex < csvText.length; characterIndex += 1) {
    const character = csvText[characterIndex];
    const nextCharacter = csvText[characterIndex + 1];

    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        cell += '"';
        characterIndex += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      record.push(cell);
      cell = '';
    } else if (character === '\n') {
      record.push(cell.replace(/\r$/, ''));
      records.push(record);
      record = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (cell.length > 0 || record.length > 0) {
    record.push(cell.replace(/\r$/, ''));
    records.push(record);
  }

  if (inQuotes) throw new Error('CSV contains an unterminated quoted field');
  return records;
}

function selectRows(rows) {
  if (rows.length === 0) throw new Error('No rows to crop');

  const seenOutputNames = new Map();
  for (const row of rows) {
    const previousLine = seenOutputNames.get(row.outputName);
    if (previousLine !== undefined) {
      throw new Error(`output_name values must be unique after sanitization; ${row.outputName} appears on rows ${previousLine} and ${row.sourceLine}`);
    }
    seenOutputNames.set(row.outputName, row.sourceLine);
  }

  return rows;
}

function rowForSummary(row) {
  return {
    sourceLine: row.sourceLine,
    address: row.address,
    addressKey: row.addressKey,
    lat: row.lat,
    lon: row.lon,
    outputName: row.outputName,
    queryDate: row.queryDate,
    location: row.location,
    locationKind: row.locationKind,
    crops: row.crops,
    raw: row.raw
  };
}

function isPlausibleOcrDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) && value <= new Date().toISOString().slice(0, 10);
}

function normalizeOutputName(value, sourceLine) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`row ${sourceLine} is missing output_name`);
  const withoutExtension = text.replace(/\.png$/i, '');
  const sanitized = sanitizePathPart(withoutExtension);
  if (!sanitized) throw new Error(`row ${sourceLine} has invalid output_name: ${text}`);
  return sanitized;
}

function parseCoordinate(value, column, sourceLine, min, max) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`row ${sourceLine} is missing ${column}`);
  const number = Number(text);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`row ${sourceLine} has invalid ${column}: ${text}`);
  return number;
}

function parseIsoDate(value, column, sourceLine) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`row ${sourceLine} has invalid ${column}; expected YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`row ${sourceLine} has invalid calendar date in ${column}: ${text}`);
  }
  return text;
}

function formatCoordinate(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function sanitizePathPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function firstPresent(raw, candidateColumns) {
  for (const column of candidateColumns) {
    const value = raw[column];
    if (String(value ?? '').trim()) return String(value).trim();
  }
  return null;
}

function hasText(value) {
  return String(value ?? '').trim().length > 0;
}

function parseOptionalPositiveInteger(value, optionName) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${optionName} must be a positive integer`);
  return number;
}

function defaultSummaryPath(imagePath) {
  const extension = path.extname(imagePath);
  if (!extension) return `${imagePath}.json`;
  return imagePath.slice(0, -extension.length) + '.json';
}

function cliOptionValue(name) {
  const prefix = `--${name}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === `--${name}`) return process.argv[index + 1] ?? null;
    if (argument.startsWith(prefix)) return argument.slice(prefix.length);
  }
  return null;
}

function cliFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printUsage() {
  console.error(`Usage: node scripts/crop_csv_batch.mjs --csv normalized.csv --output output_dir

Input CSV requirements:
  Required columns: query_date, output_name, plus one location source:
    - lat and lon, or
    - address
  query_date must be YYYY-MM-DD and is passed as the crop cutoff date.
  output_name is the output PNG basename. A trailing .png is optional and stripped.
  Optional metadata columns: address_key. If address is present with lat/lon, lat/lon is used as the location and address is kept as metadata.

Options:
  --csv                  Required normalized input CSV
  --output               Required output directory
  --limit                Optional positive row prefix limit for smoke tests
  --crop-retries         Full crop retries after core fallbacks fail. Default: 1
  --missing-ocr-retries  Retry successful crops that did not parse an imagery date. Default: 1
  --dry-run              Print planned rows without opening Google Earth
  --headed               Show Chromium for debugging

If the source CSV does not already have query_date/output_name plus lat/lon or address, copy assets/templates/normalize_csv.template.mjs to /tmp, customize it, and generate a normalized CSV before running this script.
`);
}