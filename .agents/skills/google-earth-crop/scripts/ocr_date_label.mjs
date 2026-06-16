#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  extractImageryDateFromAppendedStrip,
  optionFlag,
  optionValue,
  terminateImageryDateOcrWorker
} from './google_earth_crop_core.mjs';

const inputPath = optionValue('input') ?? optionValue('image') ?? positionalInput();
const jsonPath = optionValue('json');
const stripHeight = Number(optionValue('strip-height') ?? 42);

if (!inputPath || optionFlag('help')) {
  printUsage();
  process.exit(optionFlag('help') ? 0 : 1);
}

let result;
try {
  result = await extractImageryDateFromAppendedStrip(path.resolve(inputPath), { stripHeight });
  if (jsonPath && !optionFlag('dry-run')) await updateJson(path.resolve(jsonPath), result);
} finally {
  await terminateImageryDateOcrWorker();
}

console.log(JSON.stringify(result, null, 2));

async function updateJson(targetJsonPath, ocrResult) {
  const manifest = JSON.parse(await fs.readFile(targetJsonPath, 'utf8'));
  manifest.imageDateOcr = ocrResult.imageryDate ?? null;
  await fs.writeFile(targetJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function positionalInput() {
  const args = process.argv.slice(2);
  const optionsWithValues = new Set(['--input', '--image', '--json', '--strip-height']);
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

function printUsage() {
  console.error(`Usage: node scripts/ocr_date_label.mjs --input path/to/legacy-appended-strip-crop.png [--json path/to/crop.json]

Options:
  --input, --image       Legacy crop PNG with appended Google Earth bottom date strip. New crops OCR the strip before saving and overlay the parsed image date at top left instead.
  --json                 Optional sidecar JSON to update with imageDateOcr.
  --strip-height         Appended strip height in pixels. Default: 42.
  --dry-run              Print OCR result without updating JSON.
`);
}
