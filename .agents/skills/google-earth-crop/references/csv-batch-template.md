# CSV Batch Template

Use `assets/templates/csv_batch_runner.template.mjs` when a user asks for Google Earth crops from a CSV or spreadsheet. The template is a scaffold, not a stable command-line product.

## Workflow

1. Inspect the user's CSV headers and a few rows.
2. Copy the template to a task-specific `/tmp` file, for example `/tmp/google-earth-crop-batch-<short-task-name>.mjs`.
3. Edit only the `/tmp` copy. Do not edit the packaged template for a one-off user batch.
4. Customize `mapRecordToCropJobs(raw, { sourceLine })` for the user's schema and request.
5. Run a dry run first:
   ```bash
   node /tmp/google-earth-crop-batch-task.mjs \
     --core-module /absolute/path/to/.agents/skills/google-earth-crop/scripts/google_earth_crop_core.mjs \
     --csv input.csv \
     --output output_dir \
     --dry-run \
     --limit 3
   ```
6. Review the planned `location`, `outputKey`, and `crops[].cutoffDate` values before launching the real batch.

## Mapping Contract

`mapRecordToCropJobs` must return:

```js
{
  sourceLine,
  raw,
  address,
  addressKey,
  outputKey,
  location,
  locationKind,
  crops: [
    { phase: 'before', cutoffDate: 'YYYY-MM-DD', cutoffRule: 'event_date - 1 year' }
  ]
}
```

`location` is the exact Google Earth search string. Use `lat,lon` when reliable coordinates exist; otherwise use a full raw address/place string. Do not over-clean the search query. Only sanitize `outputKey` for filenames.

Every `crop.cutoffDate` must be normalized to `YYYY-MM-DD`. Remember that the core cropper targets the newest Google Earth timeline date before the cutoff.

## Common Cases

Coordinate CSV:

```js
const locationInfo = inferLocation(raw); // recognizes lat/lon, latitude/longitude, etc.
```

Address-only CSV:

```js
const address = `${raw.street}, ${raw.city}, ${raw.state} ${raw.zip}`;
const locationInfo = { kind: 'address', location: address, address };
```

One source date with before/after crops:

```js
const eventDate = dateFromColumn(raw, ['sale_date', 'event_date']);
crops: [
  { phase: 'before', cutoffDate: formatIsoDate(addYears(eventDate, -1)), cutoffRule: 'event date - 1 year' },
  { phase: 'after', cutoffDate: formatIsoDate(addYears(eventDate, 1)), cutoffRule: 'event date + 1 year' }
]
```

Multiple source date columns:

```js
crops: [
  { phase: 'pre', cutoffDate: formatIsoDate(dateFromColumn(raw, ['pre_cutoff_date'])), cutoffRule: 'pre_cutoff_date' },
  { phase: 'post', cutoffDate: formatIsoDate(dateFromColumn(raw, ['post_cutoff_date'])), cutoffRule: 'post_cutoff_date' }
]
```

Other derived requests belong in the `/tmp` copy. Examples: deriving an address from separate columns, filtering rows, mapping status labels into phases, using a custom row identifier, or applying date offsets other than years.

## Test Fixture

For template smoke tests, use `assets/test-data/permit-sample-10.csv`. It is a fixed-seed 10-row sample from the larger development CSV, packaged with the skill so tests do not depend on workspace-root data files. A good smoke pattern is to dry-run all 10 fixture rows, confirm 20 planned before/after crops, then run the real crop with `--limit 1`.

## Keep Stable

Avoid changing the lower crop engine path unless necessary:

- `cropWithRetries`
- browser/page reuse
- marker and date-label options
- compact per-image sidecars
- `cropGoogleEarth` calls

Verbose diagnostics belong in `batch-summary.json`; per-image sidecars should remain compact.