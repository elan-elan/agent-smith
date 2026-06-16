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
  DEFAULT_RENDER_SETTLE_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM_LEVEL,
  buildSummary,
  cameraRangeForZoomLevel,
  cropGoogleEarth,
  googleEarthQueryUrl,
  launchChromium,
  loadChromium,
  optionFlag,
  optionValue,
  parseClip,
  targetDateFor,
  terminateImageryDateOcrWorker
} from './google_earth_crop_core.mjs';

const csvPath = path.resolve(optionValue('csv') ?? 'permit_sample.csv');
const outputDir = path.resolve(optionValue('output') ?? 'data/permits_sample_v2');
const sampleSize = Number(optionValue('sample-size') ?? optionValue('limit') ?? 30);
const seed = optionValue('seed') ?? String(Date.now());
const cropRetries = Number(optionValue('crop-retries') ?? 1);
const missingOcrRetries = Number(optionValue('missing-ocr-retries') ?? 1);
const renderSettleMs = Number(optionValue('render-settle-ms') ?? DEFAULT_RENDER_SETTLE_MS);
const explicitPreferredAltitude = optionValue('preferred-camera-altitude') ?? optionValue('max-camera-altitude');
const zoomLevel = optionValue('zoom-level') ? Number(optionValue('zoom-level')) : (explicitPreferredAltitude ? null : DEFAULT_ZOOM_LEVEL);
const zoomCameraRange = cameraRangeForZoomLevel(zoomLevel);
const intermediateFallbackCameraAltitude = Number(optionValue('intermediate-fallback-camera-altitude') ?? DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE);
const largeFallbackCameraAltitude = Number(optionValue('large-fallback-camera-altitude') ?? DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE);
const minDetailScore = Number(optionValue('min-detail-score') ?? (zoomLevel && zoomLevel >= DEFAULT_ZOOM_LEVEL ? 40 : DEFAULT_MIN_DETAIL_SCORE));
const preferredCameraAltitude = Number(explicitPreferredAltitude ?? zoomCameraRange ?? 500);
const markLocation = !optionFlag('no-marker');
const markerRadius = Number(optionValue('marker-radius') ?? DEFAULT_MARKER_RADIUS);
const includeDateLabel = !optionFlag('no-date-label');
const extractImageryDate = includeDateLabel && !optionFlag('no-date-ocr') && DEFAULT_EXTRACT_IMAGERY_DATE;
const imageryDateOcrRetries = Number(optionValue('date-ocr-retries') ?? DEFAULT_IMAGERY_DATE_OCR_RETRIES);
const imageryDateOcrRetryWaitMs = Number(optionValue('date-ocr-retry-wait-ms') ?? DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS);
const viewport = DEFAULT_VIEWPORT;
const clip = parseClip(optionValue('clip'));

if (optionFlag('help')) {
  printUsage();
  process.exit(0);
}

if (!Number.isFinite(sampleSize) || sampleSize <= 0) throw new Error('--sample-size must be a positive number');
if (!Number.isFinite(cropRetries) || cropRetries < 0) throw new Error('--crop-retries must be zero or greater');
if (!Number.isFinite(missingOcrRetries) || missingOcrRetries < 0) throw new Error('--missing-ocr-retries must be zero or greater');

const csvText = await fs.readFile(csvPath, 'utf8');
const parsedRows = parsePermitRows(csvText);
const eligibleRows = parsedRows.filter((row) => row.valid && isPathSafeKey(row.addrTractKey));
const skippedRows = parsedRows.filter((row) => !row.valid || !isPathSafeKey(row.addrTractKey));
const sampledRows = selectSample(eligibleRows, sampleSize, seededRandom(seed));

await fs.mkdir(outputDir, { recursive: true });

if (optionFlag('dry-run')) {
  console.log(JSON.stringify({
    csvPath,
    outputDir,
    seed,
    requestedSampleSize: sampleSize,
    parsedRows: parsedRows.length,
    eligibleRows: eligibleRows.length,
    skippedRows: skippedRows.length,
    sampledRows: sampledRows.map(sampledRowForSummary)
  }, null, 2));
  process.exit(0);
}

const chromium = await loadChromium();
const browser = await launchChromium(chromium, { headed: optionFlag('headed') });
const context = await browser.newContext({ viewport });
const page = await context.newPage();
page.setDefaultTimeout(20000);

const perCrop = [];
const perLocation = [];
let lastConfirmedCamera = null;

try {
  for (const [sampleIndex, row] of sampledRows.entries()) {
    const phases = cropPhases(row.permitEffectiveDate);
    const locationResult = {
      sampleIndex: sampleIndex + 1,
      row: sampledRowForSummary(row),
      crops: []
    };

    for (const phase of phases) {
      const baseLabel = `${row.addrTractKey}_${phase.name}`;
      const temporaryOutputPath = path.join(outputDir, `.tmp-${process.pid}-${perCrop.length + 1}-${baseLabel}.png`);
      const result = await cropWithRetries(page, {
        location: row.location,
        outputPath: temporaryOutputPath,
        cutoffDate: phase.cutoffDate,
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

      const finalOutputPath = path.join(outputDir, `${baseLabel}_${filenameDateFor(result, phase)}.png`);
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

      const manifest = compactCropManifest({
        row,
        phase,
        result,
        jsonPath
      });
      await fs.writeFile(jsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
      locationResult.crops.push({ phase: phase.name, outputPath: finalOutputPath, jsonPath, status: result.status });
      console.log(`${result.status.toUpperCase()} ${perCrop.length}/${sampledRows.length * 2} ${path.basename(finalOutputPath)} cutoff=${phase.cutoffDate} selected=${result.selectedDate ?? 'none'} ${result.totalMs}ms`);
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
  seed,
  requestedSampleSize: sampleSize,
  parsedRows: parsedRows.length,
  eligibleRows: eligibleRows.length,
  skippedRows: skippedRows.length,
  uniquePathSafeAddrTractKeys: new Set(eligibleRows.map((row) => row.addrTractKey)).size,
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
  sampledRows: sampledRows.map(sampledRowForSummary),
  perLocation,
  perCrop
};

await fs.writeFile(path.join(outputDir, 'batch-summary.json'), `${JSON.stringify(batchReport, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.failed === 0 && summary.total === sampledRows.length * 2 ? 0 : 1);

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

function compactCropManifest({ row, phase, result, jsonPath }) {
  return JSON.parse(JSON.stringify({
    address: row.address,
    addressKey: row.addrTractKey,
    dateUsed: result.selectedDate ?? targetDateFor(phase.cutoffDate),
    cutoffDate: phase.cutoffDate,
    location: result.query,
    outputPath: result.outputPath,
    zoomLevel: result.finalZoomLevel ?? zoomLevel ?? null,
    googleEarthQueryUrl: googleEarthQueryUrl(result.query),
    imageDateOcr: result.dateLabel?.ocr?.imageryDate ?? null,
    error: result.status === 'ok' ? undefined : result.error,
    status: result.status === 'ok' ? undefined : result.status
  }));
}

function filenameDateFor(result, phase) {
  const imageryDate = result.dateLabel?.ocr?.imageryDate;
  return isPlausibleOcrDate(imageryDate) ? imageryDate : phase.cutoffDate;
}

function isPlausibleOcrDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) && value <= new Date().toISOString().slice(0, 10);
}

function cropPhases(permitEffectiveDate) {
  return [
    {
      name: 'before',
      cutoffRule: 'permit_effective_date - 1 year',
      cutoffDate: formatIsoDate(addYears(permitEffectiveDate, -1))
    },
    {
      name: 'after',
      cutoffRule: 'permit_effective_date + 1 year',
      cutoffDate: formatIsoDate(addYears(permitEffectiveDate, 1))
    }
  ];
}

function parsePermitRows(csvText) {
  const records = parseCsv(csvText).filter((record) => record.some((cell) => cell.trim()));
  if (records.length < 2) throw new Error('CSV must contain a header and at least one data row');
  const headers = records[0].map((header) => header.trim());
  const requiredHeaders = ['lon', 'lat', 'addr_tract_key', 'permit_effective_date'];
  for (const requiredHeader of requiredHeaders) {
    if (!headers.includes(requiredHeader)) throw new Error(`CSV missing required header: ${requiredHeader}`);
  }

  return records.slice(1).map((record, recordIndex) => {
    const rawRow = Object.fromEntries(headers.map((header, headerIndex) => [header, record[headerIndex] ?? '']));
    const lon = Number(rawRow.lon);
    const lat = Number(rawRow.lat);
    const permitEffectiveDate = parsePermitDate(rawRow.permit_effective_date);
    const addrTractKey = rawRow.addr_tract_key.trim();
    const address = rawRow.address?.trim() || addressFromKey(addrTractKey);
    const valid = Number.isFinite(lon)
      && Number.isFinite(lat)
      && lat >= -90
      && lat <= 90
      && lon >= -180
      && lon <= 180
      && Boolean(addrTractKey)
      && Boolean(permitEffectiveDate);
    return {
      sourceLine: recordIndex + 2,
      lon,
      lat,
      address,
      addrTractKey,
      permitEffectiveDate,
      location: `${formatCoordinate(lat)},${formatCoordinate(lon)}`,
      valid,
      invalidReason: valid ? null : invalidReason({ lon, lat, addrTractKey, permitEffectiveDate })
    };
  });
}

function addressFromKey(addrTractKey) {
  return String(addrTractKey ?? '')
    .replace(/_[A-Z]{2}_\d{3}_\d{6}$/, '')
    .replace(/_/g, ' ')
    .trim();
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

function parsePermitDate(text) {
  const match = String(text ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function addYears(date, years) {
  const targetYear = date.getUTCFullYear() + years;
  const targetMonth = date.getUTCMonth();
  const targetDay = date.getUTCDate();
  const candidate = new Date(Date.UTC(targetYear, targetMonth, targetDay));
  if (candidate.getUTCMonth() === targetMonth) return candidate;
  return new Date(Date.UTC(targetYear, targetMonth + 1, 0));
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatCoordinate(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function invalidReason(row) {
  if (!Number.isFinite(row.lon) || row.lon < -180 || row.lon > 180) return 'invalid lon';
  if (!Number.isFinite(row.lat) || row.lat < -90 || row.lat > 90) return 'invalid lat';
  if (!row.addrTractKey) return 'missing addr_tract_key';
  if (!row.permitEffectiveDate) return 'invalid permit_effective_date';
  return 'unknown';
}

function isPathSafeKey(addrTractKey) {
  return Boolean(addrTractKey) && !addrTractKey.includes('/') && !addrTractKey.includes('\0');
}

function selectSample(rows, requestedSampleSize, random) {
  const shuffledRows = shuffle([...rows], random);
  const selectedRows = [];
  const selectedKeys = new Set();
  for (const row of shuffledRows) {
    if (selectedKeys.has(row.addrTractKey)) continue;
    selectedRows.push(row);
    selectedKeys.add(row.addrTractKey);
    if (selectedRows.length === requestedSampleSize) break;
  }
  if (selectedRows.length < requestedSampleSize) {
    throw new Error(`Only ${selectedRows.length} unique path-safe eligible rows available for requested sample size ${requestedSampleSize}`);
  }
  return selectedRows;
}

function shuffle(values, random) {
  for (let currentIndex = values.length - 1; currentIndex > 0; currentIndex -= 1) {
    const swapIndex = Math.floor(random() * (currentIndex + 1));
    [values[currentIndex], values[swapIndex]] = [values[swapIndex], values[currentIndex]];
  }
  return values;
}

function seededRandom(seedText) {
  let state = hashString(seedText);
  return () => {
    state |= 0;
    state = state + 0x6d2b79f5 | 0;
    let output = Math.imul(state ^ state >>> 15, 1 | state);
    output = output + Math.imul(output ^ output >>> 7, 61 | output) ^ output;
    return ((output ^ output >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let hash = 2166136261;
  for (let characterIndex = 0; characterIndex < text.length; characterIndex += 1) {
    hash ^= text.charCodeAt(characterIndex);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sampledRowForSummary(row) {
  return {
    sourceLine: row.sourceLine,
    lon: row.lon,
    lat: row.lat,
    address: row.address,
    location: row.location,
    addrTractKey: row.addrTractKey,
    permitEffectiveDate: formatIsoDate(row.permitEffectiveDate),
    beforeCutoffDate: formatIsoDate(addYears(row.permitEffectiveDate, -1)),
    afterCutoffDate: formatIsoDate(addYears(row.permitEffectiveDate, 1))
  };
}

function defaultSummaryPath(imagePath) {
  const extension = path.extname(imagePath);
  if (!extension) return `${imagePath}.json`;
  return imagePath.slice(0, -extension.length) + '.json';
}

function printUsage() {
  console.error(`Usage: node .agents/skills/google-earth-crop/scripts/crop_permits_batch.mjs --csv permit_sample.csv --output data/permits_sample_v2 --sample-size 30

Options:
  --csv                  Input permit CSV. Default: permit_sample.csv
  --output               Output directory. Default: data/permits_sample_v2
  --sample-size, --limit Number of random unique addr_tract_key rows. Default: 30
  --seed                 Seed for reproducible sampling. Default: current timestamp
  --crop-retries         Full crop retries after core fallbacks fail. Default: 1
  --dry-run              Print sampled rows without opening Google Earth
  --headed               Show Chromium for debugging
`);
}