#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_CLIP,
  DEFAULT_MIN_CENTER_SHARPNESS_SCORE,
  DEFAULT_MIN_DETAIL_SCORE,
  DEFAULT_RENDER_SETTLE_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_ZOOM_LEVEL,
  HISTORICAL_PREVIOUS_IMAGE_CLICK,
  HISTORICAL_TILE_REFRESH_OLDER,
  analyzeShot,
  cameraFromUrl,
  cameraRangeForZoomLevel,
  cropGoogleEarth,
  googleEarthQueryUrl,
  labelForLocation,
  launchChromium,
  loadChromium,
  optionFlag,
  optionValue,
  parseClip,
  readyCameraFromUrlCamera,
  refreshHistoricalTilesBeforeCutoff,
  selectedDateFromUrl,
  showHistoricalImageryUi,
  terminateImageryDateOcrWorker,
  withCameraAltitude,
  withHistoricalDate
} from './google_earth_crop_core.mjs';

const DEFAULT_BURST_RENDER_SETTLE_MS = 1800;
const DEFAULT_HISTORY_CHANGE_TIMEOUT_MS = 10000;
const DEFAULT_HISTORY_WAIT_MS = 500;
const DEFAULT_START_YEAR = 2006;
const DEFAULT_END_YEAR = 2026;
const DEFAULT_ANNUAL_FROM_YEAR = 2016;
const DEFAULT_OLDER_YEAR_INTERVAL = 2;
const DEFAULT_NUM_WORKERS = 4;
const DEFAULT_NUM_BROWSERS = 2;
const DEFAULT_RETRY_NUM_WORKERS = 2;
const DEFAULT_RETRY_NUM_BROWSERS = 2;
const DEFAULT_MODE = 'annual-inject';
const UI_CLICK_MODES = new Map([
  ['ui-older', HISTORICAL_TILE_REFRESH_OLDER],
  ['ui-previous', HISTORICAL_PREVIOUS_IMAGE_CLICK]
]);
const BENCHMARK_MODES = ['ui-older', 'ui-previous', 'annual-inject', 'annual-crop-loop'];

const address = optionValue('address') ?? optionValue('location') ?? positionalAddress();
const startYear = Number(optionValue('start-year') ?? DEFAULT_START_YEAR);
const endYear = Number(optionValue('end-year') ?? DEFAULT_END_YEAR);
const endDate = optionValue('end-date') ?? defaultEndDate(endYear);
const annualFromYear = Number(optionValue('annual-from-year') ?? DEFAULT_ANNUAL_FROM_YEAR);
const olderYearInterval = parseOptionalPositiveInteger(optionValue('older-year-interval'), '--older-year-interval') ?? DEFAULT_OLDER_YEAR_INTERVAL;
const outputDir = path.resolve(optionValue('output') ?? path.join('benchmark-runs', 'historical-burst', labelForLocation(address ?? 'address')));
const modeText = optionValue('mode') ?? DEFAULT_MODE;
const modes = selectedModes(modeText);
const maxFrames = parseOptionalPositiveInteger(optionValue('max-frames'), '--max-frames');
const renderSettleMs = Number(optionValue('render-settle-ms') ?? DEFAULT_BURST_RENDER_SETTLE_MS);
const historyChangeTimeoutMs = Number(optionValue('history-change-timeout-ms') ?? DEFAULT_HISTORY_CHANGE_TIMEOUT_MS);
const historyWaitMs = Number(optionValue('history-wait-ms') ?? DEFAULT_HISTORY_WAIT_MS);
const qualityRetryWaitMs = Number(optionValue('quality-retry-wait-ms') ?? 3000);
const qualityRetry = optionFlag('quality-retry');
const tileRefreshRetry = qualityRetry && !optionFlag('no-tile-refresh-retry');
const numWorkers = parseOptionalPositiveInteger(optionValue('num-workers') ?? optionValue('num_workers'), '--num-workers') ?? DEFAULT_NUM_WORKERS;
const numBrowsers = parseOptionalPositiveInteger(optionValue('num-browsers') ?? optionValue('num_browsers'), '--num-browsers') ?? DEFAULT_NUM_BROWSERS;
const retryNumWorkers = parseOptionalPositiveInteger(optionValue('retry-num-workers') ?? optionValue('retry_num_workers'), '--retry-num-workers') ?? Math.min(DEFAULT_RETRY_NUM_WORKERS, numWorkers);
const retryNumBrowsers = parseOptionalPositiveInteger(optionValue('retry-num-browsers') ?? optionValue('retry_num_browsers'), '--retry-num-browsers') ?? Math.min(DEFAULT_RETRY_NUM_BROWSERS, numBrowsers);
const zoomLevel = optionValue('zoom-level') ? Number(optionValue('zoom-level')) : DEFAULT_ZOOM_LEVEL;
const preferredCameraAltitude = Number(optionValue('preferred-camera-altitude') ?? cameraRangeForZoomLevel(zoomLevel) ?? 300);
const clip = parseClip(optionValue('clip'));
const headed = optionFlag('headed');
const dryRun = optionFlag('dry-run');
const includeLatest = !optionFlag('no-latest');
const minDetailScore = Number(optionValue('min-detail-score') ?? (zoomLevel && zoomLevel >= DEFAULT_ZOOM_LEVEL ? 40 : DEFAULT_MIN_DETAIL_SCORE));
const minCenterSharpnessScore = Number(optionValue('min-center-sharpness-score') ?? DEFAULT_MIN_CENTER_SHARPNESS_SCORE);

if (!address || optionFlag('help')) {
  printUsage();
  process.exit(optionFlag('help') ? 0 : 1);
}

validateInputs();

const targetDates = annualTargetDates();
if (dryRun) {
  const dryRunSummary = {
    date: new Date().toISOString(),
    dryRun: true,
    address,
    startYear,
    endYear,
    endDate,
    annualFromYear,
    olderYearInterval,
    modes,
    outputDir,
    targetDates: targetDates.slice(0, maxFrames ?? undefined),
    totalTargetDates: targetDates.slice(0, maxFrames ?? undefined).length,
    maxFrames
  };
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, 'burst-benchmark-summary.json'), `${JSON.stringify(dryRunSummary, null, 2)}\n`);
  console.log(JSON.stringify(dryRunSummary, null, 2));
  process.exit(0);
}

const chromium = await loadChromium();
const benchmarkStart = Date.now();
const modeReports = [];

try {
  await fs.mkdir(outputDir, { recursive: true });
  for (const mode of modes) {
    const modeStart = Date.now();
    const modeOutputDir = path.join(outputDir, mode);
    await fs.rm(modeOutputDir, { recursive: true, force: true });
    await fs.mkdir(modeOutputDir, { recursive: true });

    try {
      const report = await runBurstMode(mode, modeOutputDir);
      report.totalMs = Date.now() - modeStart;
      await fs.writeFile(path.join(modeOutputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
      modeReports.push(report);
      console.log(`${mode} frames=${report.frames.length} totalMs=${report.totalMs} meanFrameMs=${report.meanFrameMs ?? 'n/a'} status=${report.status}`);
    } catch (error) {
      const report = {
        mode,
        status: 'error',
        error: String(error.stack || error.message || error).slice(0, 1000),
        frames: [],
        totalMs: Date.now() - modeStart,
        outputDir: modeOutputDir
      };
      await fs.writeFile(path.join(modeOutputDir, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
      modeReports.push(report);
      console.error(`${mode} ERROR ${error.message || error}`);
    }
  }
} finally {
  await terminateImageryDateOcrWorker();
}

const summary = {
  date: new Date().toISOString(),
  address,
  startYear,
  endYear,
  endDate,
  annualFromYear,
  olderYearInterval,
  modes,
  outputDir,
  viewport: DEFAULT_VIEWPORT,
  clip,
  zoomLevel,
  preferredCameraAltitude,
  renderSettleMs,
  historyChangeTimeoutMs,
  historyWaitMs,
  qualityRetryWaitMs,
  qualityRetry,
  tileRefreshRetry,
  numWorkers,
  numBrowsers,
  retryNumWorkers,
  retryNumBrowsers,
  includeLatest,
  targetDates,
  maxFrames,
  totalMs: Date.now() - benchmarkStart,
  results: modeReports.map((report) => summarizeModeReport(report))
};
await fs.writeFile(path.join(outputDir, 'burst-benchmark-summary.json'), `${JSON.stringify({ ...summary, reports: modeReports }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

const completedModes = modeReports.filter((report) => report.frames.length > 0 && report.status !== 'error');
process.exit(completedModes.length ? 0 : 1);

async function runBurstMode(mode, modeOutputDir) {
  const dates = targetDates.slice(0, maxFrames ?? undefined);
  if (mode === 'auto') return runAutoBurst(modeOutputDir, dates);
  return runBurstModeForDates(mode, modeOutputDir, dates, { requestedNumWorkers: numWorkers, requestedNumBrowsers: numBrowsers });
}

async function runBurstModeForDates(mode, modeOutputDir, dates, { requestedNumWorkers = numWorkers, requestedNumBrowsers = numBrowsers } = {}) {
  const parallelizable = mode === 'annual-inject' || mode === 'annual-crop-loop';
  const actualWorkers = parallelizable ? Math.min(requestedNumWorkers, dates.length) : 1;
  const actualBrowsers = actualWorkers > 0 ? Math.min(parallelizable ? requestedNumBrowsers : 1, actualWorkers) : 0;
  const browsers = [];
  for (let browserIndex = 0; browserIndex < actualBrowsers; browserIndex += 1) {
    browsers.push(await launchChromium(chromium, { headed }));
  }

  try {
    if (UI_CLICK_MODES.has(mode)) {
      const context = await browsers[0].newContext({ viewport: DEFAULT_VIEWPORT });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      try {
        return await runUiClickBurst(page, mode, modeOutputDir, UI_CLICK_MODES.get(mode), { actualWorkers, actualBrowsers });
      } finally {
        await context.close().catch(() => {});
      }
    }
    if (mode === 'annual-inject') return await runAnnualInjectBurst(mode, modeOutputDir, dates, browsers, { actualWorkers, actualBrowsers });
    if (mode === 'annual-crop-loop') return await runAnnualCropLoop(mode, modeOutputDir, dates, browsers, { actualWorkers, actualBrowsers });
  } finally {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
  }

  throw new Error(`Unsupported mode: ${mode}`);
}

async function runAutoBurst(modeOutputDir, dates) {
  const autoStart = Date.now();
  const injectDir = path.join(modeOutputDir, 'annual-inject');
  const retryDir = path.join(modeOutputDir, 'annual-crop-loop-retry');
  const finalDir = path.join(modeOutputDir, 'final');
  await fs.mkdir(injectDir, { recursive: true });
  await fs.mkdir(retryDir, { recursive: true });
  await fs.mkdir(finalDir, { recursive: true });

  const injectReport = await runBurstModeForDates('annual-inject', injectDir, dates, {
    requestedNumWorkers: numWorkers,
    requestedNumBrowsers: numBrowsers
  });
  injectReport.totalMs = Date.now() - autoStart;
  await fs.writeFile(path.join(injectDir, 'summary.json'), `${JSON.stringify(injectReport, null, 2)}\n`);

  const failedFrames = injectReport.frames.filter((frame) => frame.status !== 'ok');
  const retryDates = failedFrames.map((frame) => frame.requestedDate);
  let retryReport = null;
  if (retryDates.length) {
    const retryStart = Date.now();
    retryReport = await runBurstModeForDates('annual-crop-loop', retryDir, retryDates, {
      requestedNumWorkers: retryNumWorkers,
      requestedNumBrowsers: retryNumBrowsers
    });
    retryReport.totalMs = Date.now() - retryStart;
    await fs.writeFile(path.join(retryDir, 'summary.json'), `${JSON.stringify(retryReport, null, 2)}\n`);
  }

  const retryByRequestedDate = new Map((retryReport?.frames ?? []).map((frame) => [frame.requestedDate, frame]));
  const finalFrames = injectReport.frames.map((frame) => {
    const retryFrame = retryByRequestedDate.get(frame.requestedDate);
    const selectedFrame = retryFrame?.status === 'ok' ? retryFrame : frame;
    return {
      ...selectedFrame,
      frameNumber: frame.frameNumber,
      requestedDate: frame.requestedDate,
      mode: 'auto',
      sourceMode: selectedFrame.mode,
      recoveredFromAnnualInject: frame.status !== 'ok' && selectedFrame.status === 'ok',
      annualInjectStatus: frame.status,
      annualInjectError: frame.error ?? null,
      retryStatus: retryFrame?.status ?? null,
      retryError: retryFrame?.error ?? null
    };
  });

  await publishFinalFrames(finalDir, finalFrames);
  const recoveredFrames = finalFrames.filter((frame) => frame.recoveredFromAnnualInject).length;
  const report = buildModeReport({
    mode: 'auto',
    strategy: 'annual-inject-then-crop-loop-failed',
    modeOutputDir,
    open: {
      annualInject: injectReport.open,
      retry: retryReport?.open ?? null
    },
    frames: finalFrames,
    stopReason: retryDates.length ? 'retry-failed-annual-inject-frames' : 'annual-inject-all-ok',
    actualWorkers: injectReport.actualWorkers,
    actualBrowsers: injectReport.actualBrowsers,
    workerReports: [
      { phase: 'annual-inject', workerReports: injectReport.workerReports },
      ...(retryReport ? [{ phase: 'annual-crop-loop-retry', workerReports: retryReport.workerReports }] : [])
    ]
  });
  report.childReports = { annualInject: injectReport, annualCropLoopRetry: retryReport };
  report.retryPlan = {
    failedFrames: failedFrames.length,
    retryDates,
    recoveredFrames,
    retryNumWorkers: retryReport?.actualWorkers ?? 0,
    retryNumBrowsers: retryReport?.actualBrowsers ?? 0,
    finalOutputDir: finalDir
  };
  report.totalMs = Date.now() - autoStart;
  return report;
}

async function publishFinalFrames(finalDir, frames) {
  await fs.rm(finalDir, { recursive: true, force: true });
  await fs.mkdir(finalDir, { recursive: true });
  for (const frame of frames) {
    const safeLabel = labelForLocation(frame.requestedDate ?? `frame-${frame.frameNumber}`);
    const finalPng = path.join(finalDir, `${String(frame.frameNumber).padStart(3, '0')}-${safeLabel}.png`);
    const finalJson = finalPng.replace(/\.png$/i, '.json');
    if (frame.outputPath) await fs.copyFile(frame.outputPath, finalPng).catch(() => {});
    const record = {
      ...frame,
      outputPath: finalPng,
      jsonPath: finalJson,
      originalOutputPath: frame.outputPath,
      originalJsonPath: frame.jsonPath
    };
    await fs.writeFile(finalJson, `${JSON.stringify(record, null, 2)}\n`);
    frame.outputPath = finalPng;
    frame.jsonPath = finalJson;
  }
}

async function runUiClickBurst(page, mode, modeOutputDir, clickPoint, { actualWorkers = 1, actualBrowsers = 1 } = {}) {
  const open = await openAddress(page);
  const frames = [];
  const seenDates = new Set();
  let stopReason = 'max-frames';

  const seeded = await seedHistoricalMode(page, endDate);
  await showHistoricalImageryUi(page);
  await page.waitForTimeout(historyWaitMs);

  if (includeLatest && !isFrameLimitReached(frames)) {
    const latestSelectedDate = selectedDateFromUrl(page.url()) ?? seeded.selectedDate;
    const latestFrame = await saveBurstFrame(page, modeOutputDir, {
      mode,
      frameNumber: frames.length + 1,
      requestedDate: endDate,
      selectedDate: latestSelectedDate,
      label: 'latest',
      navigation: { strategy: 'seeded-latest-view', seeded }
    });
    frames.push(latestFrame);
    if (latestSelectedDate) seenDates.add(latestSelectedDate);
  }

  let previousSelectedDate = selectedDateFromUrl(page.url());
  while (!isFrameLimitReached(frames)) {
    const clickStart = Date.now();
    await page.mouse.click(clickPoint.x, clickPoint.y);
    const change = await waitForSelectedDateChange(page, previousSelectedDate, historyChangeTimeoutMs);
    const selectedDate = change.selectedDate;
    const navigation = {
      strategy: 'historical-ui-click',
      clickPoint,
      clickMs: Date.now() - clickStart,
      dateChanged: change.changed,
      waitMs: change.waitMs
    };

    if (!selectedDate) {
      stopReason = 'no-selected-date-after-click';
      break;
    }
    if (selectedDate < `${startYear}-01-01`) {
      stopReason = `selected-date-before-start-year:${selectedDate}`;
      break;
    }
    if (selectedDate > endDate) {
      previousSelectedDate = selectedDate;
      continue;
    }
    if (seenDates.has(selectedDate)) {
      stopReason = `repeated-selected-date:${selectedDate}`;
      break;
    }

    seenDates.add(selectedDate);
    const frame = await saveBurstFrame(page, modeOutputDir, {
      mode,
      frameNumber: frames.length + 1,
      requestedDate: selectedDate,
      selectedDate,
      label: selectedDate,
      navigation
    });
    frames.push(frame);
    previousSelectedDate = selectedDate;
  }

  return buildModeReport({ mode, strategy: 'historical-ui-click', modeOutputDir, open, frames, stopReason, actualWorkers, actualBrowsers });
}

async function runAnnualInjectBurst(mode, modeOutputDir, dates, browsers, { actualWorkers, actualBrowsers }) {
  const frames = new Array(dates.length);
  const workerReports = [];
  let nextDateIndex = 0;

  const takeNextJob = () => {
    if (nextDateIndex >= dates.length) return null;
    const dateIndex = nextDateIndex;
    nextDateIndex += 1;
    return { dateIndex, requestedDate: dates[dateIndex] };
  };

  await Promise.all(Array.from({ length: actualWorkers }, async (_, workerIndex) => {
    const workerId = workerIndex + 1;
    const browser = browsers[workerIndex % actualBrowsers];
    let context = null;
    let page = null;
    const workerStart = Date.now();
    const workerReport = { workerId, browserIndex: workerIndex % actualBrowsers, frames: 0, open: null, totalMs: null, errors: [] };

    async function openFreshPage() {
      await context?.close().catch(() => {});
      context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
      page = await context.newPage();
      page.setDefaultTimeout(20000);
      workerReport.open = await openAddress(page);
    }

    try {
      await openFreshPage();
      for (let job = takeNextJob(); job; job = takeNextJob()) {
        const { dateIndex, requestedDate } = job;
        let frame;
        try {
          const navigationStart = Date.now();
          const historicalUrl = withHistoricalDate(page.url(), requestedDate);
          const zoomUrl = withCameraAltitude(historicalUrl, preferredCameraAltitude);
          await page.goto(zoomUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(historyWaitMs);
          const selectedDate = await waitForSelectedDate(page, requestedDate, historyChangeTimeoutMs);
          frame = await saveBurstFrame(page, modeOutputDir, {
            mode,
            frameNumber: dateIndex + 1,
            requestedDate,
            selectedDate: selectedDate.selectedDate,
            label: requestedDate,
            workerId,
            navigation: {
              strategy: 'direct-date-injection',
              navigationMs: Date.now() - navigationStart,
              dateMatched: selectedDate.selectedDate === requestedDate,
              waitMs: selectedDate.waitMs
            }
          });
        } catch (error) {
          frame = await writeErrorFrame(modeOutputDir, {
            mode,
            frameNumber: dateIndex + 1,
            requestedDate,
            workerId,
            error,
            navigation: { strategy: 'direct-date-injection' }
          });
          workerReport.errors.push({ frameNumber: dateIndex + 1, requestedDate, error: frame.error });
          await openFreshPage().catch((resetError) => {
            workerReport.errors.push({ frameNumber: dateIndex + 1, requestedDate, resetError: String(resetError.message || resetError).slice(0, 300) });
          });
        }
        frames[dateIndex] = frame;
        workerReport.frames += 1;
        console.log(`${frame.status.toUpperCase()} ${dateIndex + 1}/${dates.length} ${requestedDate} selected=${frame.selectedDate ?? 'none'} ${frame.totalMs}ms worker=${workerId}`);
      }
    } catch (error) {
      workerReport.errors.push({ workerError: String(error.stack || error.message || error).slice(0, 1000) });
    } finally {
      workerReport.totalMs = Date.now() - workerStart;
      workerReports.push(workerReport);
      await context?.close().catch(() => {});
    }
  }));

  return buildModeReport({
    mode,
    strategy: 'direct-date-injection',
    modeOutputDir,
    open: workerReports.map((worker) => worker.open),
    frames: frames.filter(Boolean).sort((left, right) => left.frameNumber - right.frameNumber),
    stopReason: 'annual-dates-exhausted',
    actualWorkers,
    actualBrowsers,
    workerReports
  });
}

async function runAnnualCropLoop(mode, modeOutputDir, dates, browsers, { actualWorkers, actualBrowsers }) {
  const frames = new Array(dates.length);
  const workerReports = [];
  let nextDateIndex = 0;

  const takeNextJob = () => {
    if (nextDateIndex >= dates.length) return null;
    const dateIndex = nextDateIndex;
    nextDateIndex += 1;
    return { dateIndex, requestedDate: dates[dateIndex] };
  };

  await Promise.all(Array.from({ length: actualWorkers }, async (_, workerIndex) => {
    const workerId = workerIndex + 1;
    const browser = browsers[workerIndex % actualBrowsers];
    let context = null;
    let page = null;
    const workerStart = Date.now();
    const workerReport = { workerId, browserIndex: workerIndex % actualBrowsers, frames: 0, totalMs: null, errors: [] };

    async function openFreshPage() {
      await context?.close().catch(() => {});
      context = await browser.newContext({ viewport: DEFAULT_VIEWPORT });
      page = await context.newPage();
      page.setDefaultTimeout(20000);
    }

    try {
      await openFreshPage();
      for (let job = takeNextJob(); job; job = takeNextJob()) {
        const { dateIndex, requestedDate } = job;
        const outputPath = path.join(modeOutputDir, `${String(dateIndex + 1).padStart(3, '0')}-${requestedDate}.png`);
        const cropStart = Date.now();
        let result;
        try {
          result = await cropGoogleEarth(page, {
            location: address,
            outputPath,
            cutoffDate: nextIsoDate(requestedDate),
            renderSettleMs: Math.max(renderSettleMs, DEFAULT_RENDER_SETTLE_MS),
            minDetailScore,
            minCenterSharpnessScore,
            preferredCameraAltitude,
            zoomLevel,
            markLocation: false,
            includeDateLabel: false,
            extractImageryDate: false,
            clip,
            previousCamera: null,
            index: dateIndex + 1,
            label: requestedDate
          });
        } catch (error) {
          result = {
            status: 'error',
            error: String(error.stack || error.message || error).slice(0, 1000),
            selectedDate: null,
            totalMs: Date.now() - cropStart
          };
        }
        const frame = {
          mode,
          frameNumber: dateIndex + 1,
          requestedDate,
          selectedDate: result.selectedDate ?? null,
          status: result.status,
          outputPath,
          jsonPath: outputPath.replace(/\.png$/i, '.json'),
          totalMs: Date.now() - cropStart,
          cropGoogleEarthMs: result.totalMs,
          workerId,
          error: result.error ?? null,
          camera: result.finalCamera ?? result.camera ?? null,
          navigation: { strategy: 'crop-google-earth-loop' }
        };
        await fs.writeFile(frame.jsonPath, `${JSON.stringify({ address, ...frame, googleEarthQueryUrl: googleEarthQueryUrl(address) }, null, 2)}\n`);
        frames[dateIndex] = frame;
        workerReport.frames += 1;
        console.log(`${frame.status.toUpperCase()} ${dateIndex + 1}/${dates.length} ${requestedDate} selected=${frame.selectedDate ?? 'none'} ${frame.totalMs}ms worker=${workerId}`);
        if (result.status !== 'ok' || page?.isClosed?.()) {
          await openFreshPage().catch((resetError) => {
            workerReport.errors.push({ frameNumber: dateIndex + 1, requestedDate, resetError: String(resetError.message || resetError).slice(0, 300) });
          });
        }
      }
    } catch (error) {
      workerReport.errors.push({ workerError: String(error.stack || error.message || error).slice(0, 1000) });
    } finally {
      workerReport.totalMs = Date.now() - workerStart;
      workerReports.push(workerReport);
      await context?.close().catch(() => {});
    }
  }));

  return buildModeReport({
    mode,
    strategy: 'crop-google-earth-loop',
    modeOutputDir,
    open: null,
    frames: frames.filter(Boolean).sort((left, right) => left.frameNumber - right.frameNumber),
    stopReason: 'annual-dates-exhausted',
    actualWorkers,
    actualBrowsers,
    workerReports
  });
}

async function openAddress(page) {
  const openStart = Date.now();
  await page.goto(googleEarthQueryUrl(address), { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  const camera = await waitForReadyCamera(page, 30000);
  const zoomUrl = withCameraAltitude(page.url(), preferredCameraAltitude);
  if (zoomUrl !== page.url()) {
    await page.goto(zoomUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(historyWaitMs);
  }
  return {
    strategy: 'single-address-search',
    ms: Date.now() - openStart,
    camera: cameraFromUrl(page.url()) ?? camera,
    url: page.url()
  };
}

async function seedHistoricalMode(page, requestedDate) {
  const seedStart = Date.now();
  const historicalUrl = withHistoricalDate(page.url(), requestedDate);
  const zoomUrl = withCameraAltitude(historicalUrl, preferredCameraAltitude);
  await page.goto(zoomUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(historyWaitMs);
  const selectedDate = await waitForSelectedDate(page, requestedDate, historyChangeTimeoutMs);
  return {
    strategy: 'direct-date-seed-before-ui-clicks',
    requestedDate,
    selectedDate: selectedDate.selectedDate,
    dateMatched: selectedDate.selectedDate === requestedDate,
    waitMs: selectedDate.waitMs,
    totalMs: Date.now() - seedStart
  };
}

async function waitForReadyCamera(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastCamera = null;
  while (Date.now() < deadline) {
    const rawCamera = cameraFromUrl(page.url());
    const camera = readyCameraFromUrlCamera(rawCamera);
    if (rawCamera) lastCamera = rawCamera;
    if (camera && camera.alt > 1 && camera.alt < 5_000_000 && Math.abs(camera.lat) + Math.abs(camera.lon) > 0.001 && page.url().includes('/data=')) return camera;
    await page.waitForTimeout(100);
  }
  throw new Error(`Google Earth address readiness timed out; lastCamera=${JSON.stringify(lastCamera)} url=${page.url().slice(0, 240)}`);
}

async function waitForSelectedDateChange(page, previousSelectedDate, timeoutMs) {
  const waitStart = Date.now();
  while (Date.now() - waitStart < timeoutMs) {
    const selectedDate = selectedDateFromUrl(page.url());
    if (selectedDate && selectedDate !== previousSelectedDate) {
      return { changed: true, selectedDate, waitMs: Date.now() - waitStart };
    }
    await page.waitForTimeout(100);
  }
  return { changed: false, selectedDate: selectedDateFromUrl(page.url()), waitMs: Date.now() - waitStart };
}

async function waitForSelectedDate(page, expectedDate, timeoutMs) {
  const waitStart = Date.now();
  while (Date.now() - waitStart < timeoutMs) {
    const selectedDate = selectedDateFromUrl(page.url());
    if (selectedDate === expectedDate) return { selectedDate, waitMs: Date.now() - waitStart };
    await page.waitForTimeout(100);
  }
  return { selectedDate: selectedDateFromUrl(page.url()), waitMs: Date.now() - waitStart };
}

async function saveBurstFrame(page, modeOutputDir, frame) {
  const frameStart = Date.now();
  await page.waitForTimeout(renderSettleMs);
  let selectedDate = frame.selectedDate ?? selectedDateFromUrl(page.url()) ?? null;
  const safeLabel = labelForLocation(frame.label ?? selectedDate ?? `frame-${frame.frameNumber}`);
  const outputPath = path.join(modeOutputDir, `${String(frame.frameNumber).padStart(3, '0')}-${safeLabel}.png`);
  let screenshot = await page.screenshot({ fullPage: false, scale: 'css', clip });
  let analysis = analyzeShot(screenshot, minDetailScore, minCenterSharpnessScore);
  let qualityRetryReport = null;
  if (qualityRetry && (analysis.splash || analysis.blank || analysis.lowDetail || analysis.blurred)) {
    qualityRetryReport = { firstAnalysis: analysis, waitMs: qualityRetryWaitMs, tileRefreshRetry };
    let retriedWithTileRefresh = false;
    if (tileRefreshRetry && selectedDate && (analysis.lowDetail || analysis.blurred) && !analysis.splash && !analysis.blank) {
      const refreshResult = await refreshHistoricalTilesBeforeCutoff(page, selectedDate, frame.requestedDate ?? selectedDate, {
        clip,
        minDetailScore,
        minCenterSharpnessScore,
        currentAnalysis: analysis
      }).catch((error) => ({
        status: 'error',
        error: String(error.message || error).slice(0, 300)
      }));
      const { screenshot: refreshScreenshot, analysis: refreshAnalysis, transientUi: _transientUi, ...refreshMetadata } = refreshResult;
      qualityRetryReport.historicalTileRefresh = refreshMetadata;
      if (refreshResult.status === 'ok' && refreshScreenshot && refreshAnalysis) {
        screenshot = refreshScreenshot;
        analysis = refreshAnalysis;
        selectedDate = refreshResult.acceptedDate ?? selectedDateFromUrl(page.url()) ?? selectedDate;
        retriedWithTileRefresh = true;
      }
    }
    if (!retriedWithTileRefresh && (analysis.splash || analysis.blank || analysis.lowDetail || analysis.blurred)) {
      await page.waitForTimeout(qualityRetryWaitMs);
      screenshot = await page.screenshot({ fullPage: false, scale: 'css', clip });
      analysis = analyzeShot(screenshot, minDetailScore, minCenterSharpnessScore);
      qualityRetryReport.secondAnalysis = analysis;
    }
  }
  selectedDate = selectedDateFromUrl(page.url()) ?? selectedDate;
  await fs.writeFile(outputPath, screenshot);
  const jsonPath = outputPath.replace(/\.png$/i, '.json');
  const record = {
    address,
    mode: frame.mode,
    frameNumber: frame.frameNumber,
    requestedDate: frame.requestedDate,
    selectedDate,
    outputPath,
    jsonPath,
    googleEarthQueryUrl: googleEarthQueryUrl(address),
    pageUrl: page.url(),
    camera: cameraFromUrl(page.url()),
    workerId: frame.workerId ?? null,
    bytes: screenshot.length,
    analysis,
    status: analysis.splash || analysis.blank || analysis.lowDetail || analysis.blurred ? 'error' : 'ok',
    error: burstFrameError(analysis),
    qualityRetry: qualityRetryReport,
    renderSettleMs,
    totalMs: Date.now() - frameStart,
    navigation: frame.navigation
  };
  await fs.writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

async function writeErrorFrame(modeOutputDir, frame) {
  const safeLabel = labelForLocation(frame.label ?? frame.requestedDate ?? `frame-${frame.frameNumber}`);
  const outputPath = path.join(modeOutputDir, `${String(frame.frameNumber).padStart(3, '0')}-${safeLabel}.png`);
  const jsonPath = outputPath.replace(/\.png$/i, '.json');
  const record = {
    address,
    mode: frame.mode,
    frameNumber: frame.frameNumber,
    requestedDate: frame.requestedDate,
    selectedDate: null,
    outputPath,
    jsonPath,
    googleEarthQueryUrl: googleEarthQueryUrl(address),
    pageUrl: null,
    camera: null,
    workerId: frame.workerId ?? null,
    bytes: 0,
    analysis: null,
    status: 'error',
    error: String(frame.error?.stack || frame.error?.message || frame.error).slice(0, 1000),
    qualityRetry: null,
    renderSettleMs,
    totalMs: frame.startedAt ? Date.now() - frame.startedAt : 0,
    navigation: frame.navigation
  };
  await fs.writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function burstFrameError(analysis) {
  if (analysis.splash) return 'frame is Google Earth splash screen';
  if (analysis.blank) return 'frame is blank or flat color';
  if (analysis.lowDetail) return `frame is low detail: detailScore ${analysis.detailScore.toFixed(2)} < ${minDetailScore}`;
  if (analysis.blurred) return `frame is center blurred: centerSharpnessScore ${analysis.centerSharpnessScore.toFixed(2)} < ${minCenterSharpnessScore}`;
  return null;
}

function buildModeReport({ mode, strategy, modeOutputDir, open, frames, stopReason, actualWorkers = 1, actualBrowsers = 1, workerReports = [] }) {
  const completedFrames = frames.filter((frame) => frame.status !== 'error');
  const frameTimes = completedFrames.map((frame) => frame.totalMs).filter(Number.isFinite);
  const failedFrames = frames.length - completedFrames.length;
  return {
    mode,
    strategy,
    status: !frames.length ? 'no-frames' : failedFrames ? 'partial' : 'ok',
    address,
    outputDir: modeOutputDir,
    actualWorkers,
    actualBrowsers,
    workerReports,
    open,
    stopReason,
    totalFrames: frames.length,
    okFrames: completedFrames.length,
    failedFrames,
    firstSelectedDate: frames.find((frame) => frame.selectedDate)?.selectedDate ?? null,
    lastSelectedDate: [...frames].reverse().find((frame) => frame.selectedDate)?.selectedDate ?? null,
    meanFrameMs: frameTimes.length ? Math.round(frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length) : null,
    frames
  };
}

function summarizeModeReport(report) {
  return {
    mode: report.mode,
    status: report.status,
    strategy: report.strategy,
    totalMs: report.totalMs,
    totalFrames: report.totalFrames ?? report.frames?.length ?? 0,
    okFrames: report.okFrames ?? 0,
    failedFrames: report.failedFrames ?? 0,
    meanFrameMs: report.meanFrameMs ?? null,
    firstSelectedDate: report.firstSelectedDate ?? null,
    lastSelectedDate: report.lastSelectedDate ?? null,
    stopReason: report.stopReason ?? null,
    outputDir: report.outputDir,
    actualWorkers: report.actualWorkers ?? 1,
    actualBrowsers: report.actualBrowsers ?? 1,
    retryPlan: report.retryPlan ?? null,
    error: report.error ?? null
  };
}

function annualTargetDates() {
  const dates = [];
  for (let year = endYear; year >= startYear; year -= 1) {
    if (year < annualFromYear && year !== startYear && (year - startYear) % olderYearInterval !== 0) continue;
    dates.push(year === Number(endDate.slice(0, 4)) ? endDate : `${year}-12-31`);
  }
  return dates;
}

function selectedModes(text) {
  if (text === 'all' || text === 'benchmark') return BENCHMARK_MODES;
  return text.split(',').map((mode) => mode.trim()).filter(Boolean);
}

function parseOptionalPositiveInteger(text, flagName = '--max-frames') {
  if (!text) return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${flagName} must be a positive integer`);
  return value;
}

function isFrameLimitReached(frames) {
  return maxFrames !== null && frames.length >= maxFrames;
}

function defaultEndDate(year) {
  const localToday = localIsoDate(new Date());
  const currentYear = Number(localToday.slice(0, 4));
  return Number(year) === currentYear ? localToday : `${year}-12-31`;
}

function localIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextIsoDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function positionalAddress() {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  return positional.length ? positional.join(' ') : null;
}

function validateInputs() {
  if (!Number.isInteger(startYear) || startYear < 1900) throw new Error('--start-year must be a reasonable integer year');
  if (!Number.isInteger(endYear) || endYear < startYear) throw new Error('--end-year must be an integer year >= --start-year');
  if (!Number.isInteger(annualFromYear) || annualFromYear < startYear || annualFromYear > endYear) throw new Error('--annual-from-year must be an integer year between --start-year and --end-year');
  if (!Number.isInteger(olderYearInterval) || olderYearInterval <= 0) throw new Error('--older-year-interval must be a positive integer');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error('--end-date must be YYYY-MM-DD');
  if (Number(endDate.slice(0, 4)) !== endYear) throw new Error('--end-date year must match --end-year');
  if (!Number.isFinite(renderSettleMs) || renderSettleMs < 0) throw new Error('--render-settle-ms must be a non-negative number');
  if (!Number.isFinite(historyChangeTimeoutMs) || historyChangeTimeoutMs < 0) throw new Error('--history-change-timeout-ms must be a non-negative number');
  if (!Number.isFinite(historyWaitMs) || historyWaitMs < 0) throw new Error('--history-wait-ms must be a non-negative number');
  if (!Number.isFinite(qualityRetryWaitMs) || qualityRetryWaitMs < 0) throw new Error('--quality-retry-wait-ms must be a non-negative number');
  if (!Number.isInteger(numWorkers) || numWorkers <= 0) throw new Error('--num-workers must be a positive integer');
  if (!Number.isInteger(numBrowsers) || numBrowsers <= 0) throw new Error('--num-browsers must be a positive integer');
  if (!Number.isInteger(retryNumWorkers) || retryNumWorkers <= 0) throw new Error('--retry-num-workers must be a positive integer');
  if (!Number.isInteger(retryNumBrowsers) || retryNumBrowsers <= 0) throw new Error('--retry-num-browsers must be a positive integer');
  if (!Number.isFinite(preferredCameraAltitude) || preferredCameraAltitude <= 0) throw new Error('--preferred-camera-altitude must be positive');
  const unsupportedModes = modes.filter((mode) => !UI_CLICK_MODES.has(mode) && mode !== 'auto' && mode !== 'annual-inject' && mode !== 'annual-crop-loop');
  if (unsupportedModes.length) throw new Error(`Unsupported mode(s): ${unsupportedModes.join(', ')}`);
}

function printUsage() {
  console.log(`Usage:
  node scripts/crop_historical_burst.mjs --address "1150 Amsterdam Ave, New York, NY 10027" --output benchmark-runs/historical-burst-demo

Modes:
  --mode annual-inject     Open address once per worker, inject one date per scheduled year into each worker's current /data= URL. Default mode.
  --mode auto              Run annual-inject first, then annual-crop-loop only for failed frames.
  --mode ui-older          Open address once, show historical imagery, click the older control at ${HISTORICAL_TILE_REFRESH_OLDER.x},${HISTORICAL_TILE_REFRESH_OLDER.y}
  --mode ui-previous       Open address once, show historical imagery, click the previous control at ${HISTORICAL_PREVIOUS_IMAGE_CLICK.x},${HISTORICAL_PREVIOUS_IMAGE_CLICK.y}
  --mode annual-crop-loop  Reuse one page and call the robust crop pipeline once per year
  --mode all               Run all modes in one browser session, with a fresh context per mode

Options:
  --start-year 2006
  --end-year 2026
  --end-date YYYY-MM-DD
  --annual-from-year N     Download every year from this year through --end-year. Default ${DEFAULT_ANNUAL_FROM_YEAR}
  --older-year-interval N  Before --annual-from-year, download every N years and always include --start-year. Default ${DEFAULT_OLDER_YEAR_INTERVAL}
  --max-frames N           Useful for quick benchmarks
  --dry-run                Print the scheduled target dates and exit without launching Chromium
  --render-settle-ms N     Default ${DEFAULT_BURST_RENDER_SETTLE_MS}; lower is faster but riskier
  --quality-retry        Retry splash/blank/low-detail/blurred burst frames before saving; off by default for speed/exact zoom
  --quality-retry-wait-ms N Default 3000; extra wait when --quality-retry is enabled
  --no-tile-refresh-retry Skip the older/newer historical tile refresh when --quality-retry is enabled
  --num-workers N        Concurrent worker pages/contexts for annual modes. Default ${DEFAULT_NUM_WORKERS}
  --num-browsers N       Chromium browser processes for annual modes. Default ${DEFAULT_NUM_BROWSERS}
  --retry-num-workers N  Worker contexts for auto-mode annual-crop-loop retry pass. Default ${DEFAULT_RETRY_NUM_WORKERS}
  --retry-num-browsers N Browser processes for auto-mode annual-crop-loop retry pass. Default ${DEFAULT_RETRY_NUM_BROWSERS}
  --zoom-level N           Default ${DEFAULT_ZOOM_LEVEL}
  --clip x,y,width,height  Default ${DEFAULT_CLIP.x},${DEFAULT_CLIP.y},${DEFAULT_CLIP.width},${DEFAULT_CLIP.height}
  --headed                 Show Chromium while testing
`);
}