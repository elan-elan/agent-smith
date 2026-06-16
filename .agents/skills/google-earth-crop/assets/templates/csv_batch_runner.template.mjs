#!/usr/bin/env node

// Escape hatch only: the default CSV batch path is scripts/crop_csv_batch.mjs with
// normalized query_date/output_name plus lat/lon or address input. Prefer assets/templates/normalize_csv.template.mjs
// for adapting arbitrary source CSVs into that deterministic format.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const templateDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultCoreModulePath = path.resolve(templateDirectory, '../../scripts/google_earth_crop_core.mjs');
const coreModulePath = path.resolve(cliOptionValue('core-module') ?? process.env.GOOGLE_EARTH_CROP_CORE ?? defaultCoreModulePath);

const {
  DEFAULT_EXTRACT_IMAGERY_DATE,
  DEFAULT_IMAGERY_DATE_OCR_RETRIES,
  DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS,
  DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE,
  DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE,
  DEFAULT_MARKER_RADIUS,
  DEFAULT_MIN_DETAIL_SCORE,
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
} = await import(pathToFileURL(coreModulePath).href).catch((error) => {
  throw new Error(`Could not load Google Earth crop core module at ${coreModulePath}. When running a copied template from /tmp, pass --core-module /absolute/path/to/scripts/google_earth_crop_core.mjs or set GOOGLE_EARTH_CROP_CORE. Original error: ${error.message}`);
});

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
const preferredCameraAltitude = Number(explicitPreferredAltitude ?? zoomCameraRange ?? 500);
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
const rawRows = records.slice(1).map((record, recordIndex) => ({
  sourceLine: recordIndex + 2,
  raw: Object.fromEntries(headers.map((header, headerIndex) => [header, record[headerIndex] ?? '']))
}));

const rawRowsToPlan = rowLimit === null ? rawRows : rawRows.slice(0, rowLimit);
const plannedRows = selectRows(rawRowsToPlan.map(planRow));
const plannedCropCount = plannedRows.reduce((total, plannedRow) => total + plannedRow.crops.length, 0);

await fs.mkdir(outputDir, { recursive: true });

if (cliFlag('dry-run')) {
  console.log(JSON.stringify({
    csvPath,
    outputDir,
    coreModulePath,
    rowLimit,
    parsedRows: rawRows.length,
    rowsToProcess: plannedRows.length,
    plannedCropCount,
    rows: plannedRows.map(rowForSummary)
  }, null, 2));
  process.exit(0);
}

const chromium = await loadChromium();
const browser = await launchChromium(chromium, { headed: cliFlag('headed') });
const context = await browser.newContext({ viewport });
const page = await context.newPage();
page.setDefaultTimeout(20000);

const perCrop = [];
const perLocation = [];
let lastConfirmedCamera = null;

try {
  for (const [rowIndex, row] of plannedRows.entries()) {
    const locationResult = {
      rowIndex: rowIndex + 1,
      row: rowForSummary(row),
      crops: []
    };

    for (const cropRequest of row.crops) {
      const baseLabel = sanitizePathPart(`${row.outputKey}_${cropRequest.phase}`);
      const temporaryOutputPath = path.join(outputDir, `.tmp-${process.pid}-${perCrop.length + 1}-${baseLabel}.png`);
      const result = await cropWithRetries(page, {
        location: row.location,
        outputPath: temporaryOutputPath,
        cutoffDate: cropRequest.cutoffDate,
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
        previousCamera: lastConfirmedCamera,
        index: perCrop.length + 1,
        label: baseLabel
      }, { cropRetries, missingOcrRetries });

      const finalOutputPath = path.join(outputDir, `${baseLabel}_${filenameDateFor(result, cropRequest)}.png`);
      const jsonPath = defaultSummaryPath(finalOutputPath);
      if (result.status === 'ok') {
        await fs.rm(finalOutputPath, { force: true });
        await fs.rename(temporaryOutputPath, finalOutputPath);
      } else {
        await fs.rm(temporaryOutputPath, { force: true });
      }
      result.outputPath = finalOutputPath;

      if (result.status === 'ok') lastConfirmedCamera = result.camera;
      perCrop.push(result);

      const manifest = compactCropManifest({ row, cropRequest, result });
      await fs.writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
      locationResult.crops.push({ phase: cropRequest.phase, outputPath: finalOutputPath, jsonPath, status: result.status });
      console.log(`${result.status.toUpperCase()} ${perCrop.length}/${plannedCropCount} ${path.basename(finalOutputPath)} cutoff=${cropRequest.cutoffDate} selected=${result.selectedDate ?? 'none'} ${result.totalMs}ms`);
    }

    perLocation.push(locationResult);
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
  coreModulePath,
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

function planRow({ raw, sourceLine }) {
  try {
    const planned = mapRecordToCropJobs(raw, { sourceLine });
    validatePlannedRow(planned, sourceLine);
    return planned;
  } catch (error) {
    throw new Error(`Could not plan CSV row ${sourceLine}: ${error.message}`);
  }
}

// CUSTOMIZE THIS FUNCTION IN THE /tmp COPY FOR EACH USER REQUEST.
//
// Common adaptations:
// - Address-only CSV: keep inferLocation() and make sure an address/location column is present.
// - Coordinate CSV: keep inferLocation(); it prefers lat/lon when both are present.
// - One event date: parse that date and build one or more cutoff dates from the user's rule.
// - Multiple dates: return one crop request per date/rule.
// - Derived fields: combine columns here, e.g. `${raw.street}, ${raw.city}, ${raw.state}`.
function mapRecordToCropJobs(raw, { sourceLine }) {
  const locationInfo = inferLocation(raw);
  const cutoffDate = directCutoffDate(raw);
  const address = locationInfo.address ?? firstPresent(raw, ['address', 'full_address', 'site_address', 'location']) ?? null;
  const addressKey = firstPresent(raw, ['address_key', 'parcel_id', 'property_id', 'id'])
    ?? address
    ?? `row-${sourceLine}`;

  return {
    sourceLine,
    raw,
    address,
    addressKey,
    outputKey: sanitizePathPart(addressKey),
    location: locationInfo.location,
    locationKind: locationInfo.kind,
    crops: [
      {
        phase: 'crop',
        cutoffDate,
        cutoffRule: 'direct cutoff date from CSV'
      }
    ]
  };

  // Example for one source date with a before/after rule:
  // const eventDate = dateFromColumn(raw, ['sale_date', 'event_date']);
  // return {
  //   sourceLine,
  //   raw,
  //   address,
  //   addressKey,
  //   outputKey: sanitizePathPart(addressKey),
  //   location: locationInfo.location,
  //   locationKind: locationInfo.kind,
  //   crops: [
  //     { phase: 'before', cutoffDate: formatIsoDate(addYears(eventDate, -1)), cutoffRule: 'event date - 1 year' },
  //     { phase: 'after', cutoffDate: formatIsoDate(addYears(eventDate, 1)), cutoffRule: 'event date + 1 year' }
  //   ]
  // };
  //
  // Example for multiple date columns:
  // return {
  //   sourceLine,
  //   raw,
  //   address,
  //   addressKey,
  //   outputKey: sanitizePathPart(addressKey),
  //   location: locationInfo.location,
  //   locationKind: locationInfo.kind,
  //   crops: [
  //     { phase: 'pre', cutoffDate: formatIsoDate(dateFromColumn(raw, ['pre_cutoff_date'])), cutoffRule: 'pre_cutoff_date' },
  //     { phase: 'post', cutoffDate: formatIsoDate(dateFromColumn(raw, ['post_cutoff_date'])), cutoffRule: 'post_cutoff_date' }
  //   ]
  // };
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
    } else if (canRetryError) {
      console.warn(`RETRY ${cropOptions.label} attempt=${attemptIndex + 2} previous=${String(result.error || 'unknown').slice(0, 160)}`);
    }
    await page.waitForTimeout(1500);
  }
  return finalResult;
}

function compactCropManifest({ row, cropRequest, result }) {
  return JSON.parse(JSON.stringify({
    address: row.address,
    addressKey: row.addressKey,
    dateUsed: result.selectedDate ?? targetDateFor(cropRequest.cutoffDate),
    cutoffDate: cropRequest.cutoffDate,
    location: result.query,
    outputPath: result.outputPath,
    zoomLevel: result.finalZoomLevel ?? zoomLevel ?? null,
    googleEarthQueryUrl: googleEarthQueryUrl(result.query),
    imageDateOcr: result.dateLabel?.ocr?.imageryDate ?? null,
    error: result.status === 'ok' ? undefined : result.error,
    status: result.status === 'ok' ? undefined : result.status
  }));
}

function validatePlannedRow(row, sourceLine) {
  if (!row || typeof row !== 'object') throw new Error('mapRecordToCropJobs must return an object');
  if (!row.location) throw new Error('planned row is missing location');
  if (!row.outputKey) throw new Error('planned row is missing outputKey');
  if (!Array.isArray(row.crops) || row.crops.length === 0) throw new Error('planned row must include at least one crop request');
  for (const crop of row.crops) {
    if (!crop.phase) throw new Error(`row ${sourceLine} has a crop without phase`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(crop.cutoffDate ?? ''))) throw new Error(`row ${sourceLine} phase ${crop.phase} has invalid cutoffDate`);
  }
}

function inferLocation(raw) {
  const lat = numberFromColumn(raw, ['lat', 'latitude', 'y']);
  const lon = numberFromColumn(raw, ['lon', 'lng', 'long', 'longitude', 'x']);
  const address = firstPresent(raw, ['address', 'full_address', 'site_address', 'raw_address', 'location', 'query']);
  if (lat !== null && lon !== null) {
    return {
      kind: 'coordinates',
      location: `${formatCoordinate(lat)},${formatCoordinate(lon)}`,
      address: address ?? null
    };
  }
  if (address) return { kind: 'address', location: address, address };
  throw new Error('could not infer location; provide lat/lon columns or customize mapRecordToCropJobs for address columns');
}

function directCutoffDate(raw) {
  return formatIsoDate(dateFromColumn(raw, ['cutoff_date', 'cutoff', 'before_date', 'image_before_date', 'date']));
}

function dateFromColumn(raw, candidateColumns) {
  const rawValue = firstPresent(raw, candidateColumns);
  if (!rawValue) throw new Error(`missing date column; tried ${candidateColumns.join(', ')}`);
  return parseFlexibleDate(rawValue);
}

function parseFlexibleDate(value) {
  const text = String(value ?? '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (match) return checkedUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return checkedUtcDate(Number(match[3]), Number(match[1]), Number(match[2]));
  match = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) return checkedUtcDate(Number(match[3]), Number(match[1]), Number(match[2]));
  throw new Error(`invalid date: ${text}`);
}

function checkedUtcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`invalid calendar date: ${year}-${month}-${day}`);
  }
  return date;
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
  const selectedRows = [...rows];
  if (selectedRows.length === 0) throw new Error('No rows to crop');

  const keyCounts = new Map();
  for (const row of selectedRows) keyCounts.set(row.outputKey, (keyCounts.get(row.outputKey) ?? 0) + 1);

  return selectedRows.map((row) => ({
    ...row,
    outputKey: keyCounts.get(row.outputKey) > 1 ? `${row.outputKey}_line-${row.sourceLine}` : row.outputKey
  }));
}

function rowForSummary(row) {
  return {
    sourceLine: row.sourceLine,
    address: row.address,
    addressKey: row.addressKey,
    outputKey: row.outputKey,
    location: row.location,
    locationKind: row.locationKind,
    crops: row.crops,
    raw: row.raw
  };
}

function filenameDateFor(result, cropRequest) {
  const imageryDate = result.dateLabel?.ocr?.imageryDate;
  return isPlausibleOcrDate(imageryDate) ? imageryDate : cropRequest.cutoffDate;
}

function isPlausibleOcrDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) && value <= new Date().toISOString().slice(0, 10);
}

function addYears(date, years) {
  const targetYear = date.getUTCFullYear() + years;
  const targetMonth = date.getUTCMonth();
  const targetDay = date.getUTCDate();
  const candidate = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  if (candidate.getUTCMonth() === targetMonth) return candidate;
  return new Date(Date.UTC(targetYear, targetMonth + 1, 0));
}

function addDays(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatCoordinate(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function sanitizePathPart(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'row';
}

function firstPresent(raw, candidateColumns) {
  for (const column of candidateColumns) {
    const value = raw[column];
    if (String(value ?? '').trim()) return String(value).trim();
  }
  return null;
}

function numberFromColumn(raw, candidateColumns) {
  const value = firstPresent(raw, candidateColumns);
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
  console.error(`Usage after copying and customizing this template:
  node /tmp/my-google-earth-batch.mjs --core-module /absolute/path/to/scripts/google_earth_crop_core.mjs --csv input.csv --output output_dir

Options:
  --csv                  Required input CSV
  --output               Required output directory
  --core-module          Path to scripts/google_earth_crop_core.mjs when running from /tmp
  --limit                Optional positive row prefix limit for smoke tests
  --crop-retries         Full crop retries after core fallbacks fail. Default: 1
  --dry-run              Print planned rows and derived cutoffs without opening Google Earth
  --headed               Show Chromium for debugging

Before running, customize mapRecordToCropJobs() for the user's CSV schema, location columns, date rules, phases, and filename fields.
`);
}