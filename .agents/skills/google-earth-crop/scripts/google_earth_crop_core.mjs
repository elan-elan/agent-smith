import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_VIEWPORT = { width: 1600, height: 1200 };
export const DEFAULT_CLIP = { x: 410, y: 210, width: 780, height: 780 };
export const DEFAULT_CUTOFF_DATE = '2020-01-01';
export const DEFAULT_RENDER_SETTLE_MS = 3500;
export const DEFAULT_MIN_DETAIL_SCORE = 50;
export const DEFAULT_PREFERRED_CAMERA_ALTITUDE = 500;
export const DEFAULT_ZOOM_LEVEL = 19;
export const DEFAULT_ROOF_ZOOM_LEVEL = 21;
export const DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE = 1000;
export const DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE = 1500;
export const DEFAULT_MARKER_RADIUS = 7;
export const DEFAULT_INCLUDE_DATE_LABEL = true;
export const DEFAULT_EXTRACT_IMAGERY_DATE = true;
export const DEFAULT_IMAGERY_DATE_OCR_RETRIES = 2;
export const DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS = 1000;
const LOWEST_STANDARD_ZOOM_FALLBACK_LEVEL = 18;
const ULTRA_CLOSE_CAMERA_ALTITUDE = 100;
const ROOF_ZOOM_LEVEL_RANGE_METERS = 75;
let imageryDateOcrWorkerPromise = null;

export function optionValue(name, args = process.argv) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
}

export function optionFlag(name, args = process.argv) {
  return args.includes(`--${name}`);
}

export function labelForLocation(location) {
  return location.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'google-earth-crop';
}

export function googleEarthQueryUrl(query) {
  return `https://earth.google.com/web/search/${encodeURIComponent(query)}?hl=en`;
}

export async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch (error) {
    console.warn('Playwright package not found; running `npm install`...');
    runCommand('npm', ['install']);
    try {
      return (await import('playwright')).chromium;
    } catch (retryError) {
      throw new Error(`Unable to import Playwright after installation: ${retryError.message || retryError}`);
    }
  }
}

export async function launchChromium(chromiumInstance, { headed = false } = {}) {
  const launchOptions = { headless: !headed };
  try {
    return await chromiumInstance.launch(launchOptions);
  } catch (error) {
    const message = String(error.message || error);
    if (!/Executable doesn't exist|Please run.*playwright install|playwright install chromium/i.test(message)) throw error;
    console.warn('Playwright Chromium is unavailable; running `npx playwright install chromium`...');
    runCommand('npx', ['playwright', 'install', 'chromium']);
    return chromiumInstance.launch(launchOptions);
  }
}

export function parseClip(text) {
  if (!text) return { ...DEFAULT_CLIP };
  const values = text.split(',').map((value) => Number(value.trim()));
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Clip must be four comma-separated numbers: x,y,width,height');
  }
  const [clipX, clipY, width, height] = values;
  return { x: clipX, y: clipY, width, height };
}

export async function cropGoogleEarth(page, options) {
  const {
    location,
    outputPath,
    cutoffDate = DEFAULT_CUTOFF_DATE,
    renderSettleMs = DEFAULT_RENDER_SETTLE_MS,
    minDetailScore = DEFAULT_MIN_DETAIL_SCORE,
    preferredCameraAltitude = options.maxCameraAltitude ?? DEFAULT_PREFERRED_CAMERA_ALTITUDE,
    zoomLevel = null,
    intermediateFallbackCameraAltitude = DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE,
    largeFallbackCameraAltitude = DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE,
    markLocation = true,
    markerRadius = DEFAULT_MARKER_RADIUS,
    includeDateLabel = DEFAULT_INCLUDE_DATE_LABEL,
    extractImageryDate = includeDateLabel && DEFAULT_EXTRACT_IMAGERY_DATE,
    imageryDateOcrRetries = DEFAULT_IMAGERY_DATE_OCR_RETRIES,
    imageryDateOcrRetryWaitMs = DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS,
    strictCameraAltitude = false,
    clip = DEFAULT_CLIP,
    viewport = DEFAULT_VIEWPORT,
    previousCamera = null,
    index,
    label
  } = options;

  if (!location) throw new Error('Missing required location');
  if (!outputPath) throw new Error('Missing required outputPath');

  await ensureParentDir(outputPath);
  await fs.rm(outputPath, { force: true });

  const targetDate = targetDateFor(cutoffDate);
  const record = { index, label, query: location, outputPath };
  const runStart = Date.now();

  try {
    const targetCamera = coordinateTarget(location);
    const searchStart = Date.now();
    const directCoordinateUrl = targetCamera && previousCamera
      ? withCamera(page.url(), { ...targetCamera, alt: preferredCameraAltitude })
      : null;
    if (directCoordinateUrl) {
      record.searchStrategy = 'direct-coordinate-url';
      await page.goto(directCoordinateUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
    } else {
      record.searchStrategy = 'search-url';
      await page.goto(searchUrl(location), { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    const ready = await waitForReady(page, { previousCamera, targetCamera });
    record.searchReadyMs = Date.now() - searchStart;
    record.camera = ready.camera;
    record.targetDelta = ready.targetDelta;

    const patchStart = Date.now();
    const historicalUrl = withHistoricalDate(page.url(), targetDate);
    const requestedZoomLevel = normalizedZoomLevel(zoomLevel);
    const zoomCameraCandidates = requestedZoomLevel && !strictCameraAltitude
      ? zoomLevelCameraCandidates(requestedZoomLevel, { intermediateFallbackCameraAltitude, largeFallbackCameraAltitude })
      : null;
    const cameraCandidates = zoomCameraCandidates
      ?? (strictCameraAltitude
        ? [{ cameraAltitude: preferredCameraAltitude, zoomLevel: requestedZoomLevel, fallbackStep: 'strict-zoom' }]
        : cameraAltitudeCandidates(ready.camera.alt, preferredCameraAltitude, {
          allowWiderThanCurrent: record.searchStrategy === 'direct-coordinate-url'
        }).map((cameraAltitude) => ({ cameraAltitude, zoomLevel: null, fallbackStep: 'adaptive-altitude' })));
    const altitudeCandidates = cameraCandidates.map((candidate) => candidate.cameraAltitude);
    record.patchMs = Date.now() - patchStart;
    record.preferredCameraAltitude = preferredCameraAltitude;
    record.zoomLevel = requestedZoomLevel;
    record.zoomFallbackEnabled = Boolean(zoomCameraCandidates);
    record.intermediateFallbackCameraAltitude = zoomCameraCandidates ? intermediateFallbackCameraAltitude : null;
    record.largeFallbackCameraAltitude = zoomCameraCandidates ? largeFallbackCameraAltitude : null;
    record.zoomCameraRangeCandidates = zoomCameraCandidates?.map((candidate) => ({
      zoomLevel: candidate.zoomLevel,
      cameraRange: candidate.cameraAltitude,
      fallbackStep: candidate.fallbackStep
    }));
    record.strictCameraAltitude = strictCameraAltitude;
    record.cameraAltitudeCandidates = altitudeCandidates;
    record.zoomAttempts = [];

    let finalError = null;
    for (let altitudeIndex = 0; altitudeIndex < altitudeCandidates.length; altitudeIndex += 1) {
      const candidate = cameraCandidates[altitudeIndex];
      const altitude = candidate.cameraAltitude;
      const attempt = {
        requestedCameraAltitude: altitude,
        requestedZoomLevel: candidate.zoomLevel,
        zoomFallbackStep: candidate.fallbackStep
      };
      record.zoomAttempts.push(attempt);

      try {
        const patchedUrl = withCameraAltitude(historicalUrl, altitude);
        attempt.urlCamera = cameraFromUrl(patchedUrl);
        const historyStart = Date.now();
        await page.goto(patchedUrl, { waitUntil: 'commit', timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(500);
        const selectedDate = selectedDateFromUrl(page.url());
        if (selectedDate !== targetDate) throw new Error(`selected date ${selectedDate} !== target ${targetDate}`);
        attempt.selectedDate = selectedDate;
        attempt.finalCamera = cameraFromUrl(page.url());
        attempt.finalZoomLevel = Math.abs((attempt.finalCamera?.range ?? Infinity) - altitude) < 1e-6 ? candidate.zoomLevel : null;
        attempt.historyReadyMs = Date.now() - historyStart;

        const directCoordinateSettleMs = record.searchStrategy === 'direct-coordinate-url' ? 100 : 0;
        const ultraCloseSearchSettleMs = record.searchStrategy === 'search-url' && record.camera.alt < ULTRA_CLOSE_CAMERA_ALTITUDE ? 1000 : 0;
        const attemptRenderSettleMs = renderSettleMs + directCoordinateSettleMs + ultraCloseSearchSettleMs;
        attempt.renderSettleMs = attemptRenderSettleMs;
        await page.waitForTimeout(attemptRenderSettleMs);
        await ensureParentDir(outputPath);
        const screenshotStart = Date.now();
        const cleanShot = await screenshotWithoutTransientUi(page, clip);
        let screenshot = cleanShot.screenshot;
        recordTransientUiDismissal(attempt, cleanShot.transientUi);
        attempt.screenshotMs = Date.now() - screenshotStart;
        attempt.screenshotBytes = screenshot.length;
        attempt.analysis = analyzeShot(screenshot, minDetailScore);
        attempt.retried = false;

        if (attempt.analysis.splash || attempt.analysis.blank || attempt.analysis.lowDetail) {
          attempt.preRetryAnalysis = attempt.analysis;
          attempt.preRetryScreenshotBytes = screenshot.length;
          const skipRetryForWideRecovery = record.searchStrategy === 'direct-coordinate-url'
            && candidate.fallbackStep !== 'intermediate-fallback'
            && altitudeIndex < altitudeCandidates.length - 1
            && (attempt.analysis.splash || attempt.analysis.blank || attempt.analysis.detailScore < minDetailScore * 0.2);
          attempt.responsePolicy = skipRetryForWideRecovery ? 'skip-retry-for-wide-recovery' : 'retry-same-altitude';
          if (skipRetryForWideRecovery) {
            attempt.retried = false;
          } else {
            const retryStart = Date.now();
            await page.waitForTimeout(3000);
            const cleanRetryShot = await screenshotWithoutTransientUi(page, clip);
            screenshot = cleanRetryShot.screenshot;
            recordTransientUiDismissal(attempt, cleanRetryShot.transientUi);
            attempt.retryMs = Date.now() - retryStart;
            attempt.screenshotBytes = screenshot.length;
            attempt.analysis = analyzeShot(screenshot, minDetailScore);
            attempt.retried = true;
          }
        }

        copyAttemptToRecord(record, attempt);
        if (attempt.analysis.splash) throw new Error('final crop is Google Earth splash screen');
        if (attempt.analysis.blank) throw new Error('final crop is blank or flat color');
        if (attempt.analysis.lowDetail) throw new Error(`final crop is low detail: detailScore ${attempt.analysis.detailScore.toFixed(2)} < ${minDetailScore}`);

        const marker = locationMarkerForClip(clip, viewport, { enabled: markLocation, radius: markerRadius });
        let output = screenshot;
        if (marker.enabled && marker.visible) {
          const overlayStart = Date.now();
          const marked = await screenshotWithLocationMarker(page, marker, clip, viewport);
          output = marked.screenshot;
          recordTransientUiDismissal(attempt, marked.transientUi);
          marker.overlayMs = Date.now() - overlayStart;
          marker.sampleClip = marked.sampleClip;
          marker.pixelCheck = marked.pixelCheck;
          marker.drawn = marker.pixelCheck.redPixels >= marker.pixelCheck.minRedPixels;
          if (!marker.drawn) throw new Error(`location marker overlay not detected: ${marker.pixelCheck.redPixels} red pixels`);
        }
        attempt.marker = marker;
        const dateLabel = dateLabelForViewport(clip, viewport, { enabled: includeDateLabel });
        if (dateLabel.enabled) {
          try {
            const capture = await captureImageryDateLabelStrip(page, dateLabel.clip, {
              extractImageryDate,
              retries: imageryDateOcrRetries,
              retryWaitMs: imageryDateOcrRetryWaitMs
            });
            if (extractImageryDate) dateLabel.ocr = capture.ocr;
            const overlayText = imageDateOverlayText(dateLabel.ocr);
            if (overlayText) {
              try {
                const labeled = await overlayImageDateText(page, output, overlayText);
                output = labeled.image;
                dateLabel.included = true;
                dateLabel.position = 'overlay-top-left';
                dateLabel.overlay = labeled.overlay;
              } catch (error) {
                dateLabel.included = false;
                dateLabel.position = null;
                dateLabel.overlay = null;
                dateLabel.overlayError = String(error.message || error).slice(0, 200);
              }
            } else {
              dateLabel.included = false;
              dateLabel.position = null;
              dateLabel.overlay = null;
            }
            if (capture.strip) {
              const appended = appendPngBottomStrip(output, capture.strip);
              output = appended.image;
              dateLabel.stripAppended = true;
              dateLabel.stripPosition = 'appended-bottom';
              dateLabel.strip = appended.strip;
            }
          } catch (error) {
            dateLabel.included = false;
            dateLabel.error = String(error.message || error).slice(0, 200);
          }
        }
        attempt.dateLabel = dateLabel;
        attempt.outputBytes = output.length;
        await fs.writeFile(outputPath, output);
        copyAttemptToRecord(record, attempt);

        attempt.status = 'ok';
        finalError = null;
        break;
      } catch (error) {
        attempt.status = 'error';
        attempt.error = String(error.message || error).slice(0, 500);
        finalError = error;
      }
    }

    if (finalError) throw finalError;

    record.status = 'ok';
  } catch (error) {
    record.status = 'error';
    record.error = String(error.stack || error.message || error).slice(0, 1000);
  }

  record.totalMs = Date.now() - runStart;
  return record;
}

export function buildSummary(results) {
  const ok = results.filter((result) => result.status === 'ok');
  const totalTimes = ok.map((result) => result.totalMs).sort((left, right) => left - right);
  const detailScores = results.map((result) => result.analysis?.detailScore).filter(Number.isFinite);
  const strictCameraAltitudeResults = results.filter((result) => result.strictCameraAltitude);
  const strictCameraAltitudeOk = ok.filter((result) => result.strictCameraAltitude);
  const zoomLevelResults = results.filter((result) => Number.isFinite(result.zoomLevel));
  const zoomLevelOk = ok.filter((result) => Number.isFinite(result.zoomLevel));
  const total = results.length;

  return {
    total,
    ok: ok.length,
    failed: total - ok.length,
    meanMs: ok.length ? Math.round(ok.reduce((sum, result) => sum + result.totalMs, 0) / ok.length) : null,
    medianMs: ok.length ? totalTimes[Math.floor(totalTimes.length / 2)] : null,
    minMs: totalTimes[0] ?? null,
    maxMs: totalTimes.at(-1) ?? null,
    splashDetected: results.filter((result) => result.analysis?.splash).length,
    blankDetected: results.filter((result) => result.analysis?.blank).length,
    lowDetailDetected: results.filter((result) => result.analysis?.lowDetail).length,
    minDetailScore: detailScores.length ? Math.min(...detailScores) : null,
    markerVisible: results.filter((result) => result.marker?.visible).length,
    markerDrawn: results.filter((result) => result.marker?.drawn).length,
    markerCentered: results.filter((result) => result.marker?.centered).length,
    dateLabelIncluded: results.filter((result) => result.dateLabel?.included).length,
    dateLabelStripAppended: results.filter((result) => result.dateLabel?.stripAppended).length,
    imageryDateExtracted: results.filter((result) => result.dateLabel?.ocr?.imageryDate).length,
    strictCameraAltitudeRequired: strictCameraAltitudeResults.length,
    strictCameraAltitudeMatched: strictCameraAltitudeOk.filter((result) => Math.abs((result.finalCamera?.range ?? Infinity) - result.preferredCameraAltitude) < 1e-6).length,
    zoomFallbackRequired: zoomLevelResults.length,
    requestedZoomLevelMatched: zoomLevelOk.filter((result) => Number.isFinite(result.finalZoomLevel) && Math.abs(result.finalZoomLevel - result.zoomLevel) < 1e-6).length,
    lowerZoomFallbackUsed: zoomLevelOk.filter((result) => Number.isFinite(result.finalZoomLevel) && result.finalZoomLevel < result.zoomLevel).length,
    intermediateCameraFallbackUsed: zoomLevelOk.filter((result) => result.zoomFallbackStep === 'intermediate-fallback').length,
    largeCameraFallbackUsed: zoomLevelOk.filter((result) => result.zoomFallbackStep === 'large-fallback').length,
    retries: results.filter((result) => result.retried).length
  };
}

export function isPassingSummary(summary) {
  return summary.total > 0 && summary.ok === summary.total && summary.failed === 0 && summary.splashDetected === 0 && summary.blankDetected === 0 && summary.lowDetailDetected === 0;
}

export function targetDateFor(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function cameraRangeForZoomLevel(zoomLevel) {
  const zoom = Number(zoomLevel);
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  return ROOF_ZOOM_LEVEL_RANGE_METERS * 2 ** (DEFAULT_ROOF_ZOOM_LEVEL - zoom);
}

function normalizedZoomLevel(value) {
  const zoom = Number(value);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : null;
}

function zoomLevelCameraCandidates(zoomLevel, {
  intermediateFallbackCameraAltitude = DEFAULT_INTERMEDIATE_FALLBACK_CAMERA_ALTITUDE,
  largeFallbackCameraAltitude = DEFAULT_LARGE_FALLBACK_CAMERA_ALTITUDE
} = {}) {
  const candidates = [];
  const lowestZoomFallbackLevel = Math.max(Math.min(zoomLevel, LOWEST_STANDARD_ZOOM_FALLBACK_LEVEL), zoomLevel - 2);
  for (let candidateZoomLevel = zoomLevel; candidateZoomLevel >= lowestZoomFallbackLevel; candidateZoomLevel -= 1) {
    candidates.push({
      cameraAltitude: cameraRangeForZoomLevel(candidateZoomLevel),
      zoomLevel: candidateZoomLevel,
      fallbackStep: candidateZoomLevel === zoomLevel ? 'requested-zoom' : 'lower-zoom-fallback'
    });
  }
  const intermediateFallback = Number(intermediateFallbackCameraAltitude);
  if (Number.isFinite(intermediateFallback) && intermediateFallback > 0) {
    candidates.push({ cameraAltitude: intermediateFallback, zoomLevel: null, fallbackStep: 'intermediate-fallback' });
  }
  const largeFallback = Number(largeFallbackCameraAltitude);
  if (Number.isFinite(largeFallback) && largeFallback > 0) {
    candidates.push({ cameraAltitude: largeFallback, zoomLevel: null, fallbackStep: 'large-fallback' });
  }

  const uniqueCandidates = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.cameraAltitude) || candidate.cameraAltitude <= 0) continue;
    if (!uniqueCandidates.some((existing) => Math.abs(existing.cameraAltitude - candidate.cameraAltitude) < 1e-6)) uniqueCandidates.push(candidate);
  }
  return uniqueCandidates;
}

async function waitForReady(page, { previousCamera, targetCamera }) {
  await page.waitForURL((url) => url.toString().includes('/search/'), { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('canvas', { timeout: 15000 });
  const deadline = Date.now() + 30000;
  let lastCamera = null;

  while (Date.now() < deadline) {
    const camera = cameraFromUrl(page.url());
    if (camera) lastCamera = camera;
    const targetOk = targetCamera
      ? camera && cameraDistance(camera, targetCamera) < 0.02
      : camera && (!previousCamera || cameraDistance(camera, previousCamera) > 0.001);

    if (camera && camera.alt > 1 && camera.alt < 5_000_000 && Math.abs(camera.lat) + Math.abs(camera.lon) > 0.001 && page.url().includes('/data=') && targetOk) {
      return { camera, targetDelta: targetCamera ? cameraDistance(camera, targetCamera) : null };
    }

    await page.waitForTimeout(100);
  }

  throw new Error(`Search readiness timed out; target=${JSON.stringify(targetCamera)} lastCamera=${JSON.stringify(lastCamera)} url=${page.url().slice(0, 240)}`);
}

function runCommand(command, args) {
  const result = spawnSync(command, args, { cwd: skillDir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function searchUrl(query) {
  return googleEarthQueryUrl(query);
}

function coordinateTarget(query) {
  const match = query.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  return match ? { lat: Number(match[1]), lon: Number(match[2]) } : null;
}

function cameraDistance(camera, target) {
  return Math.abs(camera.lat - target.lat) + Math.abs(camera.lon - target.lon);
}

function cameraFromUrl(url) {
  const match = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([\d.]+)a(?:,([\d.]+)d)?/);
  if (!match) return null;
  const camera = { lat: Number(match[1]), lon: Number(match[2]), alt: Number(match[3]), range: Number(match[4]) };
  if (!Number.isFinite(camera.range)) delete camera.range;
  return Number.isFinite(camera.lat) && Number.isFinite(camera.lon) && Number.isFinite(camera.alt) ? camera : null;
}

function cameraAltitudeCandidates(currentAltitude, preferredAltitude, { allowWiderThanCurrent = false } = {}) {
  if (!Number.isFinite(currentAltitude) || currentAltitude <= 0) return [];
  const preferred = Number.isFinite(preferredAltitude) && preferredAltitude > 0 ? preferredAltitude : DEFAULT_PREFERRED_CAMERA_ALTITUDE;
  const ultraCloseInitialCamera = currentAltitude < Math.min(preferred, ULTRA_CLOSE_CAMERA_ALTITUDE);
  const closeInitialCamera = currentAltitude < preferred;
  const fallbackAltitudes = allowWiderThanCurrent && !ultraCloseInitialCamera && !closeInitialCamera
    ? [preferred, 1500, 2000, 2500, 700, 1000, currentAltitude]
    : ultraCloseInitialCamera
    ? [preferred, 500, 700, 1000, 1500, 2000, 2500, currentAltitude]
    : closeInitialCamera
      ? [currentAltitude, preferred, 500, 700, 1000, 1500, 2000, 2500]
      : [preferred, 500, 700, 1000, 1500, 2000, 2500, currentAltitude]
        .filter((altitude) => altitude >= preferred || Math.abs(altitude - currentAltitude) < 1e-6);
  const candidates = [];
  for (const altitude of fallbackAltitudes) {
    if (!Number.isFinite(altitude) || altitude <= 0) continue;
    if (!allowWiderThanCurrent && !closeInitialCamera && altitude > currentAltitude) continue;
    if (!candidates.some((candidate) => Math.abs(candidate - altitude) < 1e-6)) candidates.push(altitude);
  }
  if (!candidates.length) candidates.push(currentAltitude);
  return candidates;
}

function withCameraAltitude(url, altitude) {
  if (!Number.isFinite(altitude) || altitude <= 0) return url;
  return url.replace(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([\d.]+)a(?:,([\d.]+)d)?/, `@$1,$2,${formatAltitude(altitude)}a,${formatAltitude(altitude)}d`);
}

function withCamera(url, camera) {
  if (!Number.isFinite(camera?.lat) || !Number.isFinite(camera?.lon) || !Number.isFinite(camera?.alt) || camera.alt <= 0) return null;
  if (!url.includes('/data=') || !cameraFromUrl(url)) return null;
  const range = Number.isFinite(camera.range) && camera.range > 0 ? camera.range : camera.alt;
  return url.replace(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),([\d.]+)a(?:,([\d.]+)d)?/, `@${formatCoordinate(camera.lat)},${formatCoordinate(camera.lon)},${formatAltitude(camera.alt)}a,${formatAltitude(range)}d`);
}

function locationMarkerForClip(clip, viewport, { enabled, radius }) {
  const x = viewport.width / 2 - clip.x;
  const y = viewport.height / 2 - clip.y;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_MARKER_RADIUS;
  const centerOffsetX = x - clip.width / 2;
  const centerOffsetY = y - clip.height / 2;
  return {
    enabled,
    drawn: false,
    source: 'viewport-camera-center',
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    centerOffsetX: Number(centerOffsetX.toFixed(3)),
    centerOffsetY: Number(centerOffsetY.toFixed(3)),
    centered: Math.abs(centerOffsetX) < 1e-6 && Math.abs(centerOffsetY) < 1e-6,
    radius: safeRadius,
    fill: '#ff0000',
    stroke: '#ffffff',
    strokeWidth: 2,
    visible: x >= 0 && x <= clip.width && y >= 0 && y <= clip.height
  };
}

function dateLabelForViewport(clip, viewport, { enabled }) {
  const height = 42;
  return {
    enabled,
    included: false,
    source: 'google-earth-visible-bottom-status-bar',
    position: null,
    clip: {
      x: 0,
      y: Math.max(0, viewport.height - height),
      width: Math.min(viewport.width, Math.max(clip.width, 780)),
      height
    },
    overlay: null
  };
}

function imageDateOverlayText(ocr) {
  if (!ocr?.imageryDate) return null;
  const qualifier = ocr.qualifier ? `${ocr.qualifier} ` : '';
  return `Image date: ${qualifier}${ocr.imageryDate}`;
}

export async function extractImageryDateFromStrip(stripPng) {
  const worker = await loadImageryDateOcrWorker();
  const { data } = await worker.recognize(stripPng);
  const text = normalizeImageryDateOcrText(data.text ?? '');
  const parsed = parseImageryDateFromOcrText(text);
  const fallback = parsed ? null : await extractImageryDateFromProcessedStrip(worker, stripPng);
  return {
    source: 'tesseract.js-bottom-strip',
    text,
    imageryDate: parsed?.imageryDate ?? fallback?.imageryDate ?? null,
    qualifier: parsed?.qualifier ?? fallback?.qualifier ?? null,
    confidence: Number.isFinite(data.confidence) ? Number(data.confidence.toFixed(1)) : null,
    fallback
  };
}

export async function extractImageryDateFromAppendedStrip(imagePath, { stripHeight = 42 } = {}) {
  const worker = await loadImageryDateOcrWorker();
  const image = await fs.readFile(imagePath);
  const { width, height } = pngDimensions(image);
  const rectangle = {
    left: 0,
    top: Math.max(0, height - stripHeight),
    width: Math.min(width, 780),
    height: Math.min(stripHeight, height)
  };
  const { data } = await worker.recognize(image, { rectangle });
  const text = normalizeImageryDateOcrText(data.text ?? '');
  const parsed = parseImageryDateFromOcrText(text);
  const fallback = parsed ? null : await extractImageryDateFromProcessedStrip(worker, cropPngStrip(image, rectangle));
  return {
    source: 'tesseract.js-appended-bottom-strip',
    text,
    imageryDate: parsed?.imageryDate ?? fallback?.imageryDate ?? null,
    qualifier: parsed?.qualifier ?? fallback?.qualifier ?? null,
    confidence: Number.isFinite(data.confidence) ? Number(data.confidence.toFixed(1)) : null,
    fallback,
    rectangle
  };
}

export async function terminateImageryDateOcrWorker() {
  if (!imageryDateOcrWorkerPromise) return;
  const workerPromise = imageryDateOcrWorkerPromise;
  imageryDateOcrWorkerPromise = null;
  const worker = await workerPromise.catch(() => null);
  await worker?.terminate?.();
}

async function loadImageryDateOcrWorker() {
  if (!imageryDateOcrWorkerPromise) {
    imageryDateOcrWorkerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng', undefined, {
        cachePath: path.join(skillDir, 'node_modules', '.cache', 'tesseract')
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: ' 0123456789/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-<>:.',
        preserve_interword_spaces: '1'
      });
      return worker;
    })().catch((error) => {
      imageryDateOcrWorkerPromise = null;
      throw error;
    });
  }
  return imageryDateOcrWorkerPromise;
}

function normalizeImageryDateOcrText(text) {
  return text
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseImageryDateFromOcrText(text) {
  const match = text.match(/(?:(older|newer|newest|latest)\s*[-<: ]*)?(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/i);
  if (!match) return null;

  const month = Number(match[2]);
  const day = Number(match[3]);
  const year = Number(match[4]);
  const imageryDate = mdyToIsoDate(month, day, year);
  if (!imageryDate) return null;

  return {
    imageryDate,
    qualifier: match[1]?.toLowerCase() ?? null
  };
}

function mdyToIsoDate(month, day, year) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

async function extractImageryDateFromProcessedStrip(worker, stripPng) {
  const candidates = processedStripOcrCandidates(stripPng);
  let best = null;
  for (const candidate of candidates) {
    const { data } = await worker.recognize(candidate.png);
    const text = normalizeImageryDateOcrText(data.text ?? '');
    const parsed = parseImageryDateFromOcrText(text);
    const result = {
      source: `tesseract.js-processed-bottom-strip:${candidate.name}`,
      text,
      imageryDate: parsed?.imageryDate ?? null,
      qualifier: parsed?.qualifier ?? null,
      confidence: Number.isFinite(data.confidence) ? Number(data.confidence.toFixed(1)) : null
    };
    if (result.imageryDate) return result;
    if (!best || (result.confidence ?? 0) > (best.confidence ?? 0)) best = result;
  }
  return best;
}

function processedStripOcrCandidates(stripPng) {
  const { width, height, data } = decodePngRgba(stripPng);
  return [
    buildThresholdStripPng(data, width, height, { scale: 3, threshold: 190 }),
    buildThresholdStripPng(data, width, height, { scale: 2, threshold: 190 }),
    buildThresholdStripPng(data, width, height, { scale: 3, threshold: 150 })
  ];
}

function buildThresholdStripPng(data, width, height, { scale, threshold }) {
  const outputWidth = width * scale;
  const outputHeight = height * scale;
  const pixels = Buffer.alloc(outputWidth * outputHeight);
  for (let yPosition = 0; yPosition < outputHeight; yPosition += 1) {
    const sourceY = Math.floor(yPosition / scale);
    for (let xPosition = 0; xPosition < outputWidth; xPosition += 1) {
      const sourceX = Math.floor(xPosition / scale);
      const offset = (sourceY * width + sourceX) * 4;
      const brightness = 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
      pixels[yPosition * outputWidth + xPosition] = brightness < threshold ? 0 : 255;
    }
  }
  return {
    name: `scale${scale}-threshold${threshold}`,
    png: encodeGrayscalePng(outputWidth, outputHeight, pixels)
  };
}

function cropPngStrip(image, rectangle) {
  const { width, height, data } = decodePngRgba(image);
  const left = Math.max(0, Math.min(width - 1, Math.floor(rectangle.left)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(rectangle.top)));
  const cropWidth = Math.max(1, Math.min(width - left, Math.floor(rectangle.width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.floor(rectangle.height)));
  const pixels = Buffer.alloc(cropWidth * cropHeight * 4);
  for (let yPosition = 0; yPosition < cropHeight; yPosition += 1) {
    const sourceStart = ((top + yPosition) * width + left) * 4;
    const sourceEnd = sourceStart + cropWidth * 4;
    data.copy(pixels, yPosition * cropWidth * 4, sourceStart, sourceEnd);
  }
  return encodeRgbaPng(cropWidth, cropHeight, pixels);
}

function appendPngBottomStrip(imagePng, stripPng) {
  const image = decodePngRgba(imagePng);
  const strip = decodePngRgba(stripPng);
  const outputWidth = image.width;
  const outputHeight = image.height + strip.height;
  const stripCopyWidth = Math.min(outputWidth, strip.width);
  const pixels = Buffer.alloc(outputWidth * outputHeight * 4);
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255;

  for (let yPosition = 0; yPosition < image.height; yPosition += 1) {
    const sourceStart = yPosition * image.width * 4;
    const sourceEnd = sourceStart + image.width * 4;
    const targetStart = yPosition * outputWidth * 4;
    image.data.copy(pixels, targetStart, sourceStart, sourceEnd);
  }

  for (let yPosition = 0; yPosition < strip.height; yPosition += 1) {
    const sourceStart = yPosition * strip.width * 4;
    const sourceEnd = sourceStart + stripCopyWidth * 4;
    const targetStart = (image.height + yPosition) * outputWidth * 4;
    strip.data.copy(pixels, targetStart, sourceStart, sourceEnd);
  }

  return {
    image: encodeRgbaPng(outputWidth, outputHeight, pixels),
    strip: {
      source: 'google-earth-visible-bottom-status-bar',
      position: 'appended-bottom',
      width: outputWidth,
      height: strip.height,
      sourceWidth: strip.width,
      sourceHeight: strip.height,
      copiedWidth: stripCopyWidth
    }
  };
}

function pngDimensions(png) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, signature.length).equals(signature)) throw new Error('Invalid PNG signature');
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20)
  };
}

function encodeGrayscalePng(width, height, pixels) {
  const rows = Buffer.alloc((width + 1) * height);
  for (let yPosition = 0; yPosition < height; yPosition += 1) {
    const rowOffset = yPosition * (width + 1);
    rows[rowOffset] = 0;
    pixels.copy(rows, rowOffset + 1, yPosition * width, (yPosition + 1) * width);
  }
  return encodePng(width, height, 0, rows);
}

function encodeRgbaPng(width, height, pixels) {
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let yPosition = 0; yPosition < height; yPosition += 1) {
    const rowOffset = yPosition * (stride + 1);
    rows[rowOffset] = 0;
    pixels.copy(rows, rowOffset + 1, yPosition * stride, (yPosition + 1) * stride);
  }
  return encodePng(width, height, 6, rows);
}

function encodePng(width, height, colorType, filteredRows) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(filteredRows)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function captureImageryDateLabelStrip(page, clip, { extractImageryDate, retries, retryWaitMs } = {}) {
  await showHistoricalImageryUi(page);
  const retryLimit = Math.max(0, Math.floor(Number.isFinite(retries) ? retries : DEFAULT_IMAGERY_DATE_OCR_RETRIES));
  const waitMs = Math.max(0, Math.floor(Number.isFinite(retryWaitMs) ? retryWaitMs : DEFAULT_IMAGERY_DATE_OCR_RETRY_WAIT_MS));
  const maxAttempts = extractImageryDate ? retryLimit + 1 : 1;
  let latest = null;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const strip = await page.screenshot({ fullPage: false, scale: 'css', clip });
    if (!extractImageryDate) return { strip, ocr: null };

    let ocr;
    try {
      ocr = await extractImageryDateFromStrip(strip);
    } catch (error) {
      ocr = { error: String(error.message || error).slice(0, 200) };
    }

    latest = {
      strip,
      ocr: {
        ...ocr,
        attempts: attemptNumber,
        retryLimit
      }
    };

    if (ocr.imageryDate || attemptNumber === maxAttempts) return latest;
    await page.waitForTimeout(waitMs);
  }

  return latest;
}

async function screenshotWithoutTransientUi(page, clip) {
  const screenshot = await page.screenshot({ fullPage: false, scale: 'css', clip });
  const transientUi = detectAskGoogleEarthHelpPopup(screenshot);
  if (!transientUi.detected) return { screenshot, transientUi };

  await page.mouse.click(clip.x + transientUi.dismiss.x, clip.y + transientUi.dismiss.y).catch(() => {});
  await page.waitForTimeout(500);
  const cleanedScreenshot = await page.screenshot({ fullPage: false, scale: 'css', clip });
  const cleanedUi = detectAskGoogleEarthHelpPopup(cleanedScreenshot);
  return {
    screenshot: cleanedScreenshot,
    transientUi: {
      ...transientUi,
      dismissed: true,
      stillDetectedAfterDismiss: cleanedUi.detected
    }
  };
}

function recordTransientUiDismissal(attempt, transientUi) {
  if (!transientUi?.detected) return;
  attempt.transientUiDismissals = attempt.transientUiDismissals ?? [];
  attempt.transientUiDismissals.push(transientUi);
}

function detectAskGoogleEarthHelpPopup(screenshot) {
  const { width, height, data } = decodePngRgba(screenshot);
  const scanHeight = Math.floor(Math.min(width, height) * 0.42);
  const xMin = Math.floor(width * 0.35);
  const xMax = Math.floor(width * 0.98);
  let bestRun = { length: 0, y: 0, start: 0, end: 0 };

  for (let yPosition = 0; yPosition < scanHeight; yPosition += 2) {
    let runStart = null;
    for (let xPosition = xMin; xPosition < xMax; xPosition += 1) {
      const offset = (yPosition * width + xPosition) * 4;
      if (isGoogleEarthHelpPopupBackground(data[offset], data[offset + 1], data[offset + 2])) {
        if (runStart === null) runStart = xPosition;
      } else if (runStart !== null) {
        const length = xPosition - runStart;
        if (length > bestRun.length) bestRun = { length, y: yPosition, start: runStart, end: xPosition - 1 };
        runStart = null;
      }
    }
    if (runStart !== null) {
      const length = xMax - runStart;
      if (length > bestRun.length) bestRun = { length, y: yPosition, start: runStart, end: xMax - 1 };
    }
  }

  const minimumRun = Math.min(240, width * 0.28);
  if (bestRun.length < minimumRun) return { type: 'ask-google-earth-help', detected: false };

  let top = null;
  let bottom = null;
  for (let yPosition = 0; yPosition < scanHeight; yPosition += 2) {
    let hits = 0;
    let total = 0;
    for (let xPosition = bestRun.start; xPosition <= bestRun.end; xPosition += 4) {
      const offset = (yPosition * width + xPosition) * 4;
      total += 1;
      if (isGoogleEarthHelpPopupBackground(data[offset], data[offset + 1], data[offset + 2])) hits += 1;
    }

    if (hits / Math.max(total, 1) > 0.45) {
      if (top === null) top = yPosition;
      bottom = yPosition;
    }
  }

  const cardHeight = top === null || bottom === null ? 0 : bottom - top;
  const detected = cardHeight > Math.min(110, height * 0.18) && bestRun.start > width * 0.35 && bestRun.end < width * 0.98;
  return {
    type: 'ask-google-earth-help',
    detected,
    dismissed: false,
    bounds: detected ? { x: bestRun.start, y: top, width: bestRun.length, height: cardHeight } : undefined,
    dismiss: detected ? {
      x: Math.round(bestRun.start + bestRun.length * 0.5),
      y: Math.round(bottom - cardHeight * 0.18)
    } : undefined
  };
}

function isGoogleEarthHelpPopupBackground(red, green, blue) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const brightness = (red + green + blue) / 3;
  const neutralLight = brightness > 224 && max - min < 32;
  const paleBlue = red > 175 && red < 235 && green > 200 && blue > 215 && blue - red > 8;
  return neutralLight || paleBlue;
}

async function showHistoricalImageryUi(page) {
  await page.mouse.click(45, 150).catch(() => {});
  await page.waitForTimeout(300);
  await page.mouse.click(176.5, 16);
  await page.waitForTimeout(500);
  await page.mouse.click(294, 140);
  await page.waitForTimeout(1500);
}

async function overlayImageDateText(page, imagePng, text) {
  const imageDataUrl = `data:image/png;base64,${imagePng.toString('base64')}`;
  const overlay = {
    text,
    position: 'top-left',
    x: 12,
    y: 12,
    paddingX: 8,
    paddingY: 5,
    borderRadius: 4,
    font: '600 18px Arial, sans-serif',
    textColor: '#ffffff',
    backgroundColor: 'rgba(0, 0, 0, 0.72)'
  };
  const result = await page.evaluate(async ({ imageDataUrl, overlay }) => {
    const loadImage = (source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Unable to load PNG for composition'));
      image.src = source;
    });
    const image = await loadImage(imageDataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);

    context.font = overlay.font;
    context.textBaseline = 'top';
    const metrics = context.measureText(overlay.text);
    const textHeight = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) || 18;
    const boxWidth = Math.ceil(metrics.width + overlay.paddingX * 2);
    const boxHeight = Math.ceil(textHeight + overlay.paddingY * 2 + 2);
    const boxX = overlay.x;
    const boxY = overlay.y;
    const radius = Math.min(overlay.borderRadius, boxWidth / 2, boxHeight / 2);

    context.beginPath();
    context.moveTo(boxX + radius, boxY);
    context.lineTo(boxX + boxWidth - radius, boxY);
    context.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + radius);
    context.lineTo(boxX + boxWidth, boxY + boxHeight - radius);
    context.quadraticCurveTo(boxX + boxWidth, boxY + boxHeight, boxX + boxWidth - radius, boxY + boxHeight);
    context.lineTo(boxX + radius, boxY + boxHeight);
    context.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - radius);
    context.lineTo(boxX, boxY + radius);
    context.quadraticCurveTo(boxX, boxY, boxX + radius, boxY);
    context.closePath();
    context.fillStyle = overlay.backgroundColor;
    context.fill();
    context.fillStyle = overlay.textColor;
    context.fillText(overlay.text, boxX + overlay.paddingX, boxY + overlay.paddingY);

    return {
      base64: canvas.toDataURL('image/png').split(',')[1],
      overlay: {
        ...overlay,
        width: boxWidth,
        height: boxHeight
      }
    };
  }, { imageDataUrl, overlay });
  return {
    image: Buffer.from(result.base64, 'base64'),
    overlay: result.overlay
  };
}

async function screenshotWithLocationMarker(page, marker, clip, viewport) {
  const markerId = '__google_earth_crop_marker__';
  const absoluteX = clip.x + marker.x;
  const absoluteY = clip.y + marker.y;
  await page.evaluate(async ({ marker, markerId, absoluteX, absoluteY }) => {
    document.getElementById(markerId)?.remove();
    const element = document.createElement('div');
    element.id = markerId;
    Object.assign(element.style, {
      position: 'fixed',
      left: `${absoluteX}px`,
      top: `${absoluteY}px`,
      width: `${(marker.radius + marker.strokeWidth) * 2}px`,
      height: `${(marker.radius + marker.strokeWidth) * 2}px`,
      transform: 'translate(-50%, -50%)',
      borderRadius: '9999px',
      border: `${marker.strokeWidth}px solid ${marker.stroke}`,
      background: marker.fill,
      boxSizing: 'border-box',
      boxShadow: '0 0 3px rgba(0, 0, 0, 0.65)',
      pointerEvents: 'none',
      zIndex: '2147483647'
    });
    document.documentElement.appendChild(element);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }, { marker, markerId, absoluteX, absoluteY });

  try {
    const cleanShot = await screenshotWithoutTransientUi(page, clip);
    const screenshot = cleanShot.screenshot;
    const pixelCheck = analyzeMarkerPixels(screenshot, marker);
    return { screenshot, pixelCheck, transientUi: cleanShot.transientUi };
  } finally {
    await page.evaluate((markerId) => document.getElementById(markerId)?.remove(), markerId).catch(() => {});
  }
}

function analyzeMarkerPixels(screenshot, marker) {
  const { width, height, data } = decodePngRgba(screenshot);
  const radius = Math.ceil(marker.radius + marker.strokeWidth + 2);
  const xStart = Math.max(0, Math.floor(marker.x - radius));
  const xEnd = Math.min(width - 1, Math.ceil(marker.x + radius));
  const yStart = Math.max(0, Math.floor(marker.y - radius));
  const yEnd = Math.min(height - 1, Math.ceil(marker.y + radius));
  let sampledPixels = 0;
  let redPixels = 0;

  for (let yPosition = yStart; yPosition <= yEnd; yPosition += 1) {
    for (let xPosition = xStart; xPosition <= xEnd; xPosition += 1) {
      const distance = Math.hypot(xPosition - marker.x, yPosition - marker.y);
      if (distance > marker.radius + 1) continue;
      const offset = (yPosition * width + xPosition) * 4;
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      sampledPixels += 1;
      if (red > 180 && green < 100 && blue < 100 && red - green > 80 && red - blue > 80) redPixels += 1;
    }
  }

  const minRedPixels = Math.max(1, Math.floor(marker.radius * marker.radius * 0.4));
  return {
    sampledPixels,
    redPixels,
    minRedPixels,
    redRatio: redPixels / Math.max(sampledPixels, 1)
  };
}

function formatAltitude(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function formatCoordinate(value) {
  return String(Number(value.toFixed(7)));
}

function copyAttemptToRecord(record, attempt) {
  record.requestedCameraAltitude = attempt.urlCamera?.alt ?? attempt.requestedCameraAltitude ?? null;
  record.requestedZoomLevel = attempt.requestedZoomLevel ?? null;
  record.finalZoomLevel = attempt.finalZoomLevel ?? null;
  record.zoomFallbackStep = attempt.zoomFallbackStep;
  record.cameraAltitudeClamped = Number.isFinite(record.requestedCameraAltitude) && record.camera.alt > record.requestedCameraAltitude;
  record.selectedDate = attempt.selectedDate;
  record.finalCamera = attempt.finalCamera;
  record.historyReadyMs = attempt.historyReadyMs;
  record.screenshotMs = attempt.screenshotMs;
  record.screenshotBytes = attempt.screenshotBytes;
  record.outputBytes = attempt.outputBytes;
  record.analysis = attempt.analysis;
  record.marker = attempt.marker;
  record.dateLabel = attempt.dateLabel;
  record.transientUiDismissals = attempt.transientUiDismissals;
  record.retried = attempt.retried;
  if (attempt.retryMs) record.retryMs = attempt.retryMs;
}

function decodeDataPayload(data) {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64 + '='.repeat((4 - (base64.length % 4)) % 4), 'base64');
}

function encodeDataPayload(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function selectedDateFromUrl(url) {
  const match = url.match(/\/data=([^?#]+)/);
  if (!match) return null;
  const dates = decodeDataPayload(match[1]).toString('latin1').match(/\d{4}-\d{2}-\d{2}/g);
  return dates?.at(-1) ?? null;
}

function withHistoricalDate(url, dateText) {
  const [prefix, rest] = url.split('/data=');
  if (!rest) throw new Error('No Google Earth /data= payload');
  const [data, query = 'hl=en'] = rest.split('?');
  const binary = decodeDataPayload(data);
  const existingDate = binary.toString('latin1').match(/\d{4}-\d{2}-\d{2}/);

  if (existingDate) {
    const patched = Buffer.concat([binary.subarray(0, existingDate.index), Buffer.from(dateText, 'ascii'), binary.subarray(existingDate.index + 10)]);
    return `${prefix}/data=${encodeDataPayload(patched)}?${query}`;
  }

  if (binary[0] !== 0x0a) throw new Error('Unexpected payload shape');
  const root = readVarint(binary, 1);
  const marker = Buffer.from([0x42, 0x02, 0x08, 0x01, 0x42, 0x02, 0x08, 0x00, 0x4a]);
  const insertion = binary.indexOf(marker, root.pos);
  if (insertion < 0) throw new Error('Historical insertion point not found');

  const field = Buffer.concat([Buffer.from([0x2a, 0x10, 0x08, 0x01, 0x12, 0x0a]), Buffer.from(dateText, 'ascii'), Buffer.from([0x18, 0x01])]);
  const content = Buffer.concat([binary.subarray(root.pos, insertion), field, binary.subarray(insertion)]);
  const patched = Buffer.concat([Buffer.from([binary[0]]), writeVarint(root.result + field.length), content]);
  return `${prefix}/data=${encodeDataPayload(patched)}?${query}`;
}

function readVarint(buffer, start) {
  let result = 0;
  let shift = 0;
  let position = start;

  while (position < buffer.length) {
    const byte = buffer[position++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return { result, pos: position };
}

function writeVarint(value) {
  const bytes = [];
  let remaining = value;

  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }

  bytes.push(remaining);
  return Buffer.from(bytes);
}

function analyzeShot(screenshot, minDetailScore) {
  const { width, height, data } = decodePngRgba(screenshot);

  const countRegion = (xStartRatio, xEndRatio, yStartRatio, yEndRatio, predicate) => {
    let count = 0;
    let hits = 0;
    const xStart = Math.floor(width * xStartRatio);
    const xEnd = Math.floor(width * xEndRatio);
    const yStart = Math.floor(height * yStartRatio);
    const yEnd = Math.floor(height * yEndRatio);
    for (let yPosition = yStart; yPosition < yEnd; yPosition += 4) {
      for (let xPosition = xStart; xPosition < xEnd; xPosition += 4) {
        const offset = (yPosition * width + xPosition) * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        count += 1;
        if (predicate(red, green, blue)) hits += 1;
      }
    }
    return hits / Math.max(count, 1);
  };

  let sampleCount = 0;
  let brightnessSum = 0;
  let brightnessSquareSum = 0;
  for (let yPosition = 0; yPosition < height; yPosition += 8) {
    for (let xPosition = 0; xPosition < width; xPosition += 8) {
      const offset = (yPosition * width + xPosition) * 4;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      sampleCount += 1;
      brightnessSum += brightness;
      brightnessSquareSum += brightness * brightness;
    }
  }

  const brightnessMean = brightnessSum / Math.max(sampleCount, 1);
  const brightnessVariance = brightnessSquareSum / Math.max(sampleCount, 1) - brightnessMean * brightnessMean;
  const brightnessStd = Math.sqrt(Math.max(brightnessVariance, 0));
  const logoWhite = countRegion(0.52, 0.95, 0.08, 0.28, (red, green, blue) => red > 215 && green > 215 && blue > 215 && Math.max(red, green, blue) - Math.min(red, green, blue) < 25);
  const spinnerBlue = countRegion(0.65, 0.82, 0.28, 0.48, (red, green, blue) => blue > 145 && green > 85 && green < 180 && red < 90 && blue - red > 90);
  const darkLeft = countRegion(0.00, 0.50, 0.00, 0.58, (red, green, blue) => (red + green + blue) / 3 < 55);
  const flatGreen = countRegion(0.00, 1.00, 0.00, 1.00, (red, green, blue) => green > 80 && green > red * 1.25 && green > blue * 1.25);

  let detailCount = 0;
  let gradientSum = 0;
  let gradientSquareSum = 0;
  let strongEdges = 0;
  let veryStrongEdges = 0;
  for (let yPosition = 2; yPosition < height - 2; yPosition += 2) {
    for (let xPosition = 2; xPosition < width - 2; xPosition += 2) {
      const offset = (yPosition * width + xPosition) * 4;
      const right = (yPosition * width + xPosition + 2) * 4;
      const down = ((yPosition + 2) * width + xPosition) * 4;
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      const rightBrightness = (data[right] + data[right + 1] + data[right + 2]) / 3;
      const downBrightness = (data[down] + data[down + 1] + data[down + 2]) / 3;
      const gradient = Math.abs(brightness - rightBrightness) + Math.abs(brightness - downBrightness);
      detailCount += 1;
      gradientSum += gradient;
      gradientSquareSum += gradient * gradient;
      if (gradient > 18) strongEdges += 1;
      if (gradient > 35) veryStrongEdges += 1;
    }
  }

  const gradientMean = gradientSum / Math.max(detailCount, 1);
  const gradientVariance = gradientSquareSum / Math.max(detailCount, 1) - gradientMean * gradientMean;
  const strongEdgeRatio = strongEdges / Math.max(detailCount, 1);
  const veryStrongEdgeRatio = veryStrongEdges / Math.max(detailCount, 1);
  const detailScore = gradientMean * (1 + strongEdgeRatio * 10);

  return {
    width,
    height,
    logoWhite,
    spinnerBlue,
    darkLeft,
    flatGreen,
    brightnessStd,
    gradientMean,
    gradientStd: Math.sqrt(Math.max(gradientVariance, 0)),
    strongEdgeRatio,
    veryStrongEdgeRatio,
    detailScore,
    splash: logoWhite > 0.03 && (spinnerBlue > 0.001 || darkLeft > 0.70),
    blank: flatGreen > 0.85 || brightnessStd < 5,
    lowDetail: detailScore < minDetailScore
  };
}

function decodePngRgba(png) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, signature.length).equals(signature)) throw new Error('Invalid PNG signature');

  let width = null;
  let height = null;
  let bitDepth = null;
  let colorType = null;
  let interlace = null;
  const idatChunks = [];

  for (let offset = signature.length; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunk = png.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === 'IDAT') {
      idatChunks.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height) throw new Error('PNG missing IHDR');
  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('Unsupported interlaced PNG');

  const sourceChannels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!sourceChannels) throw new Error(`Unsupported PNG color type ${colorType}`);

  const stride = width * sourceChannels;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const source = Buffer.alloc(width * height * sourceChannels);
  let inputOffset = 0;

  for (let yPosition = 0; yPosition < height; yPosition += 1) {
    const filter = inflated[inputOffset++];
    const rowOffset = yPosition * stride;
    for (let xByte = 0; xByte < stride; xByte += 1) {
      const value = inflated[inputOffset++];
      const left = xByte >= sourceChannels ? source[rowOffset + xByte - sourceChannels] : 0;
      const up = yPosition > 0 ? source[rowOffset - stride + xByte] : 0;
      const upLeft = yPosition > 0 && xByte >= sourceChannels ? source[rowOffset - stride + xByte - sourceChannels] : 0;
      let reconstructed;
      if (filter === 0) reconstructed = value;
      else if (filter === 1) reconstructed = value + left;
      else if (filter === 2) reconstructed = value + up;
      else if (filter === 3) reconstructed = value + Math.floor((left + up) / 2);
      else if (filter === 4) reconstructed = value + paethPredictor(left, up, upLeft);
      else throw new Error(`Unsupported PNG filter ${filter}`);
      source[rowOffset + xByte] = reconstructed & 0xff;
    }
  }

  if (sourceChannels === 4) return { width, height, data: source };

  const rgba = Buffer.alloc(width * height * 4);
  for (let sourceOffset = 0, targetOffset = 0; sourceOffset < source.length; sourceOffset += 3, targetOffset += 4) {
    rgba[targetOffset] = source[sourceOffset];
    rgba[targetOffset + 1] = source[sourceOffset + 1];
    rgba[targetOffset + 2] = source[sourceOffset + 2];
    rgba[targetOffset + 3] = 255;
  }
  return { width, height, data: rgba };
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}