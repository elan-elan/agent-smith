#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const inputOption = cliOptionValue('input') ?? cliOptionValue('csv');
const outputOption = cliOptionValue('output') ?? cliOptionValue('out');
const rowLimit = parseOptionalPositiveInteger(cliOptionValue('limit'), '--limit');

if (cliFlag('help')) {
  printUsage();
  process.exit(0);
}

if (!inputOption) throw new Error('--input is required');
if (!outputOption) throw new Error('--output is required');

const inputPath = path.resolve(inputOption);
const outputPath = path.resolve(outputOption);
const csvText = await fs.readFile(inputPath, 'utf8');
const records = parseCsv(csvText).filter((record) => record.some((cell) => cell.trim()));
if (records.length < 2) throw new Error('CSV must contain a header and at least one data row');

const headers = records[0].map((header) => header.trim());
const rawRows = records.slice(1).map((record, recordIndex) => ({
  sourceLine: recordIndex + 2,
  raw: Object.fromEntries(headers.map((header, headerIndex) => [header, record[headerIndex] ?? '']))
}));

const rowsToNormalize = rowLimit === null ? rawRows : rawRows.slice(0, rowLimit);
const normalizedRows = rowsToNormalize.flatMap(({ raw, sourceLine }) => {
  const rows = normalizeRecordToRows(raw, { sourceLine });
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`row ${sourceLine} did not produce any normalized rows`);
  return rows.map((row) => validateNormalizedRow(row, sourceLine));
});

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, toCsv(normalizedRows), 'utf8');
console.log(JSON.stringify({ inputPath, outputPath, sourceRows: rowsToNormalize.length, normalizedRows: normalizedRows.length }, null, 2));

// CUSTOMIZE THIS FUNCTION IN THE /tmp COPY FOR EACH USER REQUEST.
// It must return one or more rows with query_date, output_name, and one location source:
// either lat/lon or address.
function normalizeRecordToRows(raw, { sourceLine }) {
  const lat = firstPresent(raw, ['lat', 'latitude', 'y']);
  const lon = firstPresent(raw, ['lon', 'lng', 'long', 'longitude', 'x']);
  const queryDate = formatIsoDate(dateFromColumn(raw, ['query_date', 'cutoff_date', 'date']));
  const address = firstPresent(raw, ['address', 'full_address', 'site_address', 'location']) ?? '';
  const outputName = firstPresent(raw, ['output_name', 'output_key', 'name'])
    ?? firstPresent(raw, ['address_key', 'addr_tract_key', 'parcel_id', 'property_id', 'id'])
    ?? `row-${sourceLine}`;

  return [{
    lat,
    lon,
    query_date: queryDate,
    output_name: outputName,
    address,
    address_key: firstPresent(raw, ['address_key', 'addr_tract_key', 'parcel_id', 'property_id', 'id']) ?? ''
  }];

  // Example for a source row with one event date that should produce before/after crops:
  // const eventDate = dateFromColumn(raw, ['source_event_date', 'event_date']);
  // const addressKey = firstPresent(raw, ['addr_tract_key', 'address_key', 'id']) ?? `row-${sourceLine}`;
  // return [
  //   { lat, lon, query_date: formatIsoDate(addYears(eventDate, -1)), output_name: `${addressKey}_before`, address, address_key: addressKey },
  //   { lat, lon, query_date: formatIsoDate(addYears(eventDate, 1)), output_name: `${addressKey}_after`, address, address_key: addressKey }
  // ];
}

function validateNormalizedRow(row, sourceLine) {
  const normalized = {
    lat: String(row.lat ?? '').trim(),
    lon: String(row.lon ?? '').trim(),
    address: String(row.address ?? '').trim(),
    query_date: formatIsoDate(parseIsoDate(requireText(row.query_date, 'query_date', sourceLine))),
    output_name: sanitizeOutputName(requireText(row.output_name, 'output_name', sourceLine), sourceLine),
    address_key: String(row.address_key ?? '')
  };
  const hasLat = hasText(normalized.lat);
  const hasLon = hasText(normalized.lon);
  if (hasLat || hasLon) {
    if (!hasLat || !hasLon) throw new Error(`row ${sourceLine} must include both lat and lon, or use address without partial coordinates`);
    validateCoordinate(normalized.lat, 'lat', sourceLine, -90, 90);
    validateCoordinate(normalized.lon, 'lon', sourceLine, -180, 180);
  } else if (!hasText(normalized.address)) {
    throw new Error(`row ${sourceLine} must include either lat/lon or address`);
  }
  return normalized;
}

function requireText(value, column, sourceLine) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`row ${sourceLine} is missing ${column}`);
  return text;
}

function validateCoordinate(value, column, sourceLine, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`row ${sourceLine} has invalid ${column}: ${value}`);
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

function parseIsoDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`invalid query_date; expected YYYY-MM-DD: ${text}`);
  return checkedUtcDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

function checkedUtcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`invalid calendar date: ${year}-${month}-${day}`);
  }
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

function toCsv(rows) {
  const headers = ['lat', 'lon', 'address', 'query_date', 'output_name', 'address_key'];
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((header) => csvEscape(row[header] ?? '')).join(','));
  return `${lines.join('\n')}\n`;
}

function sanitizeOutputName(value, sourceLine) {
  const withoutExtension = String(value ?? '').trim().replace(/\.png$/i, '');
  const sanitized = withoutExtension
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  if (!sanitized) throw new Error(`row ${sourceLine} has invalid output_name: ${value}`);
  return sanitized;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
  node /tmp/normalize-google-earth-csv.mjs --input source.csv --output /tmp/normalized.csv

The output CSV is for scripts/crop_csv_batch.mjs and must contain query_date, output_name, and either lat/lon or address.
Customize normalizeRecordToRows() for the user's source headers and date rules.
`);
}