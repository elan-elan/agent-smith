# CSV Batch Normalization

Use `scripts/crop_csv_batch.mjs` for CSV/spreadsheet batches whenever possible. It is deterministic and accepts normalized CSV rows with `query_date`, `output_name`, and one location source: either `lat`+`lon` or `address`.

Use `assets/templates/normalize_csv.template.mjs` when the user's source CSV does not already have that shape. The normalizer template is a scaffold: copy it to `/tmp`, customize it for the user's headers and date rules, and write a normalized CSV. Then run the deterministic batch script.

Keep `assets/templates/csv_batch_runner.template.mjs` only for unusual custom workflows that cannot be represented as normalized rows.

## Workflow

1. Inspect the user's CSV headers and a few rows.
2. If the CSV already has `query_date`, `output_name`, and either `lat`+`lon` or `address`, run `scripts/crop_csv_batch.mjs` directly.
3. Otherwise copy `assets/templates/normalize_csv.template.mjs` to a task-specific `/tmp` file, for example `/tmp/normalize-google-earth-csv-<short-task-name>.mjs`.
4. Edit only the `/tmp` copy. Do not edit the packaged template for a one-off user batch.
5. Customize `normalizeRecordToRows(raw, { sourceLine })` for the user's schema and request.
6. Write and inspect the normalized CSV.
7. Run a crop dry run first:
   ```bash
   node scripts/crop_csv_batch.mjs \
     --csv /tmp/normalized-google-earth-crops.csv \
     --output output_dir \
     --dry-run \
     --limit 3
   ```
8. Review the planned `location`, `outputName`, and `queryDate` values before launching the real batch.

## Mapping Contract

The normalized CSV must use one of these row formats:

Coordinate rows:

```csv
lat,lon,query_date,output_name,address,address_key
33.748995,-84.387982,2020-01-01,atlanta_before,"Atlanta, GA",atlanta
```

Address rows:

```csv
address,query_date,output_name,address_key
"1150 Amsterdam Ave, New York, NY 10027",2025-01-01,1150_amsterdam_before,1150_amsterdam
```

Required common columns:

- `query_date` (`YYYY-MM-DD`)
- `output_name` (the PNG basename; `.png` is optional and stripped)

Required location source:

- `lat` and `lon`, or
- `address`

Optional columns:

- `address_key`
- `address` as metadata when `lat`/`lon` are present

Every requested crop is one normalized row. If the user wants before/after images, produce two normalized rows with different `query_date` and `output_name` values. Encode all request-specific naming in `output_name`, for example `{addr_tract_key}_before` and `{addr_tract_key}_after`.

## Common Cases

Already normalized CSV:

```bash
node scripts/crop_csv_batch.mjs --csv input.csv --output output_dir --dry-run
```

Address-only normalized CSV:

```csv
address,query_date,output_name,address_key
"1150 Amsterdam Ave, New York, NY 10027",2025-01-01,1150_amsterdam_before,1150_amsterdam
```

Prompt-derived before/after filenames in the normalizer:

```js
const eventDate = dateFromColumn(raw, ['permit_effective_date', 'event_date']);
const addressKey = firstPresent(raw, ['addr_tract_key', 'address_key', 'id']);
const address = firstPresent(raw, ['address', 'full_address', 'site_address']);
return [
  { address, query_date: formatIsoDate(addYears(eventDate, -1)), output_name: `${addressKey}_before`, address_key: addressKey },
  { address, query_date: formatIsoDate(addYears(eventDate, 1)), output_name: `${addressKey}_after`, address_key: addressKey }
];
```

One source date with before/after crops in the normalizer:

```js
const eventDate = dateFromColumn(raw, ['sale_date', 'event_date']);
const outputBase = firstPresent(raw, ['output_name', 'parcel_id', 'id']);
return [
  { lat, lon, query_date: formatIsoDate(addYears(eventDate, -1)), output_name: `${outputBase}_before`, address, address_key: outputBase },
  { lat, lon, query_date: formatIsoDate(addYears(eventDate, 1)), output_name: `${outputBase}_after`, address, address_key: outputBase }
];
```

Multiple source date columns in the normalizer:

```js
const outputBase = firstPresent(raw, ['output_name', 'parcel_id', 'id']);
return [
  { lat, lon, query_date: formatIsoDate(dateFromColumn(raw, ['pre_cutoff_date'])), output_name: `${outputBase}_pre`, address, address_key: outputBase },
  { lat, lon, query_date: formatIsoDate(dateFromColumn(raw, ['post_cutoff_date'])), output_name: `${outputBase}_post`, address, address_key: outputBase }
];
```

Address-only source CSVs do not need geocoding if they have a usable `address` string; Google Earth address search is the location source. Prefer full street/city/state/ZIP addresses to reduce ambiguity.

Other derived requests belong in the `/tmp` normalizer copy. Examples: deriving an address from separate columns, filtering rows, composing output names from status labels, using a custom row identifier, or applying date offsets other than years.

## Test Fixture

For batch smoke tests, use `assets/test-data/permit-sample-10.csv` for coordinate rows and `assets/test-data/address-sample-2.csv` for address rows. They are already normalized and packaged with the skill so tests do not depend on workspace-root data files. A good smoke pattern is to dry-run all rows, then run the real crop with `--limit 1` and an output under `benchmark-runs/`. Keep the smoke PNG, compact JSON sidecar, and `batch-summary.json` under `benchmark-runs/` so batch test artifacts live beside the benchmark outputs instead of in `/tmp`.

## Keep Stable

Avoid changing the deterministic crop batch path unless necessary:

- input validation for `query_date`, `output_name`, and either `lat`/`lon` or `address`
- direct `output_name` filename control
- browser/page reuse
- marker and date-label options
- compact per-image sidecars
- `cropGoogleEarth` calls

Verbose diagnostics belong in `batch-summary.json`; per-image sidecars should remain compact.