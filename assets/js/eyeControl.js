const STORAGE_KEY = 'paa_eye_config_v9';
const LONG_BLINK_MS = 1500;
const TOGGLE_COOLDOWN_MS = 2300;
const DWELL_MS = 7000;
const DEADZONE_X = 0.09;
const DEADZONE_Y = 0.045;
const BLINK_CLOSE_RATIO = 0.105;
const BLINK_OPEN_RATIO = 0.155;
const AUTO_CENTER_CALIBRATION_MS = 1900;
const AUTO_FACE_STABLE_MS = 650;
const OVERLAY_FAILSAFE_MS = 8500;
const DEFAULT_HORIZONTAL_SPAN = 0.115;
const DEFAULT_EYE_POSITIVE_SPAN = 0.18;
const DEFAULT_EYE_NEGATIVE_SPAN = 0.18;
const DEFAULT_OPEN_POSITIVE_SPAN = 0.04;
const DEFAULT_OPEN_NEGATIVE_SPAN = 0.04;
const DEFAULT_PITCH_POSITIVE_SPAN = 0.18;
const DEFAULT_PITCH_NEGATIVE_SPAN = 0.18;
const VISION_BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs';
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const LEFT_EYE = {
  outer: 33,
  inner: 133,
  top: 159,
  bottom: 145,
  iris: [468, 469, 470, 471, 472]
};

const RIGHT_EYE = {
  outer: 362,
  inner: 263,
  top: 386,
  bottom: 374,
  iris: [473, 474, 475, 476, 477]
};

const BLINK_POINTS = {
  left: { top: 159, bottom: 145, outer: 33, inner: 133 },
  right: { top: 386, bottom: 374, outer: 362, inner: 263 }
};

const HEAD_POINTS = {
  forehead: 10,
  nose: 1,
  chin: 152
};

const state = {
  loading: false,
  cameraActive: false,
  faceDetected: false,
  trackingText: 'Aguardando câmera',
  blinkText: 'Olhos abertos',
  blinkClosed: false,
  controlActive: false,
  cursorVisible: true,
  calibrated: false,
  calibrationText: 'Ajuste inicial pendente',
  calibrationProgress: 0,
  sensitivity: 2,
  smoothing: 8,
  dwellMs: 0,
  targetLabel: 'Nenhum alvo',
  calibrationData: null,
  needsCalibration: true
};

let listeners = [];
let videoEl;
let cursorEl;
let overlayEl;
let targetEl;
let progressBarEl;
let titleEl;
let descEl;
let badgeEl;
let placeholderEl;
let overlayCloseButton;
let faceLandmarker = null;
let stream = null;
let lastVideoTime = -1;
let lastFrameTime = performance.now();
let lastToggleTime = 0;
let blinkStartTime = 0;
let blinkConsumed = false;
let rafId = 0;
let filteredSample = { x: 0.5, eyeVertical: 0, openness: 0.28, pitch: 1.05 };
let currentRawSample = { x: 0.5, eyeVertical: 0, openness: 0.28, pitch: 1.05 };
let cursorPosition = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
let currentTarget = null;
let dwellStart = 0;
let neutralCapture = null;
let autoStartRequested = false;
let overlayFailsafeTimer = 0;

function emit() {
  listeners.forEach((listener) => listener(getEyeControlState()));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averagePoint(points) {
  if (!points.length) return { x: 0.5, y: 0.5 };
  return { x: average(points.map((point) => point.x)), y: average(points.map((point) => point.y)) };
}

function averageSample(samples) {
  if (!samples.length) return { x: 0.5, eyeVertical: 0, openness: 0.28, pitch: 1.05 };
  return {
    x: average(samples.map((sample) => sample.x)),
    eyeVertical: average(samples.map((sample) => sample.eyeVertical)),
    openness: average(samples.map((sample) => sample.openness)),
    pitch: average(samples.map((sample) => sample.pitch))
  };
}

function loadStoredConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (typeof stored.sensitivity === 'number') state.sensitivity = clamp(stored.sensitivity, 1, 10);
    if (typeof stored.smoothing === 'number') state.smoothing = clamp(stored.smoothing, 1, 10);
  } catch {
    // ignore
  }
}

function saveStoredConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sensitivity: state.sensitivity,
    smoothing: state.smoothing
  }));
}

function clearStoredCalibration() {
  state.calibrationData = null;
  state.calibrated = false;
  state.needsCalibration = true;
  state.controlActive = false;
  state.calibrationText = 'Ajuste inicial da sessão pendente';
  state.calibrationProgress = 0;
  saveStoredConfig();
}

function getEyeGeometry(landmarks, eye) {
  const outer = landmarks[eye.outer];
  const inner = landmarks[eye.inner];
  const top = landmarks[eye.top];
  const bottom = landmarks[eye.bottom];
  const irisCenter = averagePoint(eye.iris.map((index) => landmarks[index]));

  const minX = Math.min(outer.x, inner.x);
  const maxX = Math.max(outer.x, inner.x);
  const width = Math.max(Math.abs(inner.x - outer.x), 0.0001);
  const height = Math.max(Math.abs(bottom.y - top.y), 0.0001);
  const topGap = Math.max(irisCenter.y - top.y, 0);
  const bottomGap = Math.max(bottom.y - irisCenter.y, 0);

  return {
    x: clamp((irisCenter.x - minX) / Math.max(maxX - minX, 0.0001), 0, 1),
    verticalBias: clamp((bottomGap - topGap) / height, -1.6, 1.6),
    openness: clamp(height / width, 0.12, 0.7)
  };
}

function computeBlinkRatio(landmarks) {
  const leftVertical = Math.abs(landmarks[BLINK_POINTS.left.top].y - landmarks[BLINK_POINTS.left.bottom].y);
  const leftHorizontal = Math.abs(landmarks[BLINK_POINTS.left.outer].x - landmarks[BLINK_POINTS.left.inner].x);
  const rightVertical = Math.abs(landmarks[BLINK_POINTS.right.top].y - landmarks[BLINK_POINTS.right.bottom].y);
  const rightHorizontal = Math.abs(landmarks[BLINK_POINTS.right.outer].x - landmarks[BLINK_POINTS.right.inner].x);
  const leftRatio = leftVertical / Math.max(leftHorizontal, 0.0001);
  const rightRatio = rightVertical / Math.max(rightHorizontal, 0.0001);
  return (leftRatio + rightRatio) / 2;
}

function computeHeadPitchMetric(landmarks) {
  const forehead = landmarks[HEAD_POINTS.forehead];
  const nose = landmarks[HEAD_POINTS.nose];
  const chin = landmarks[HEAD_POINTS.chin];
  const foreheadToNose = Math.abs(nose.y - forehead.y);
  const noseToChin = Math.abs(chin.y - nose.y);
  return clamp(noseToChin / Math.max(foreheadToNose, 0.0001), 0.45, 2.6);
}

function updateCursorVisual() {
  if (!cursorEl) return;
  cursorEl.style.left = `${cursorPosition.x}px`;
  cursorEl.style.top = `${cursorPosition.y}px`;
  cursorEl.classList.toggle('hidden', !state.cursorVisible);
  cursorEl.classList.toggle('paused', !state.controlActive);
  cursorEl.classList.toggle('is-dwell', Boolean(currentTarget));
}

function clearOverlayFailsafe() {
  if (overlayFailsafeTimer) {
    clearTimeout(overlayFailsafeTimer);
    overlayFailsafeTimer = 0;
  }
}

function scheduleOverlayFailsafe() {
  clearOverlayFailsafe();
  overlayFailsafeTimer = window.setTimeout(() => {
    hideOverlay();
  }, OVERLAY_FAILSAFE_MS);
}

function ensureOverlayCloseButton() {
  if (!overlayEl || overlayCloseButton) return;
  overlayCloseButton = document.createElement('button');
  overlayCloseButton.type = 'button';
  overlayCloseButton.setAttribute('aria-label', 'Fechar aviso de ajuste');
  overlayCloseButton.textContent = '×';
  overlayCloseButton.style.position = 'absolute';
  overlayCloseButton.style.top = '18px';
  overlayCloseButton.style.right = '18px';
  overlayCloseButton.style.width = '40px';
  overlayCloseButton.style.height = '40px';
  overlayCloseButton.style.borderRadius = '999px';
  overlayCloseButton.style.border = '1px solid rgba(255,255,255,0.16)';
  overlayCloseButton.style.background = 'rgba(255,255,255,0.08)';
  overlayCloseButton.style.color = '#fff';
  overlayCloseButton.style.fontSize = '26px';
  overlayCloseButton.style.cursor = 'pointer';
  overlayCloseButton.style.zIndex = '2';
  overlayCloseButton.addEventListener('click', () => hideOverlay());
  overlayEl.style.position = 'fixed';
  overlayEl.appendChild(overlayCloseButton);
}

function updateOverlay({ title, description, progress = 0, badge = 'Preparando', showTarget = false }) {
  if (!overlayEl) return;
  ensureOverlayCloseButton();
  scheduleOverlayFailsafe();
  overlayEl.classList.remove('hidden');
  titleEl.textContent = title;
  descEl.textContent = description;
  badgeEl.textContent = badge;
  progressBarEl.style.width = `${clamp(progress, 0, 100)}%`;
  targetEl.classList.toggle('hidden', !showTarget);
}

function hideOverlay() {
  if (!overlayEl) return;
  clearOverlayFailsafe();
  overlayEl.classList.add('hidden');
}

function clearDwell() {
  if (currentTarget) currentTarget.classList.remove('is-dwell');
  currentTarget = null;
  dwellStart = 0;
  state.dwellMs = 0;
  state.targetLabel = 'Nenhum alvo';
}

function isClickable(element) {
  if (!element || !(element instanceof HTMLElement)) return false;
  return Boolean(element.closest('button, a, input, select, textarea, [data-eye-click], [role="button"], .nav-button, .btn, .test-target'));
}

function handleDwell(now) {
  if (state.controlActive || !state.cursorVisible) {
    clearDwell();
    return;
  }

  const element = document.elementFromPoint(cursorPosition.x, cursorPosition.y);
  const clickable = element?.closest('button, a, input, select, textarea, [data-eye-click], [role="button"], .nav-button, .btn, .test-target');

  if (!isClickable(clickable)) {
    clearDwell();
    return;
  }

  if (currentTarget !== clickable) {
    clearDwell();
    currentTarget = clickable;
    currentTarget.classList.add('is-dwell');
    dwellStart = now;
  }

  state.dwellMs = now - dwellStart;
  state.targetLabel = (currentTarget.textContent || currentTarget.getAttribute('aria-label') || 'Alvo').trim();

  if (state.dwellMs >= DWELL_MS) {
    currentTarget.classList.remove('is-dwell');
    currentTarget.click();
    clearDwell();
  }
}

function updateAdaptiveCalibration(sample) {
  const calibration = state.calibrationData;
  if (!calibration) return;
  const ext = calibration.extremes;
  ext.eyeMin = Math.min(ext.eyeMin, sample.eyeVertical);
  ext.eyeMax = Math.max(ext.eyeMax, sample.eyeVertical);
  ext.openMin = Math.min(ext.openMin, sample.openness);
  ext.openMax = Math.max(ext.openMax, sample.openness);
  ext.pitchMin = Math.min(ext.pitchMin, sample.pitch);
  ext.pitchMax = Math.max(ext.pitchMax, sample.pitch);
}

function normalizeSigned(delta, negativeSpan, positiveSpan) {
  if (delta >= 0) return clamp(delta / Math.max(positiveSpan, 0.0001), -1.8, 1.8);
  return clamp(delta / Math.max(negativeSpan, 0.0001), -1.8, 1.8);
}

function mapSampleToAxes(sample) {
  const calibration = state.calibrationData;
  if (!calibration?.neutral) return { x: 0, y: 0 };

  const neutral = calibration.neutral;
  const ext = calibration.extremes;
  const horizontalSpan = calibration.horizontalSpan || DEFAULT_HORIZONTAL_SPAN;

  const eyePositiveSpan = Math.max(ext.eyeMax - neutral.eyeVertical, calibration.eyePositiveSpan || DEFAULT_EYE_POSITIVE_SPAN);
  const eyeNegativeSpan = Math.max(neutral.eyeVertical - ext.eyeMin, calibration.eyeNegativeSpan || DEFAULT_EYE_NEGATIVE_SPAN);
  const openPositiveSpan = Math.max(ext.openMax - neutral.openness, calibration.openPositiveSpan || DEFAULT_OPEN_POSITIVE_SPAN);
  const openNegativeSpan = Math.max(neutral.openness - ext.openMin, calibration.openNegativeSpan || DEFAULT_OPEN_NEGATIVE_SPAN);
  const pitchPositiveSpan = Math.max(ext.pitchMax - neutral.pitch, calibration.pitchPositiveSpan || DEFAULT_PITCH_POSITIVE_SPAN);
  const pitchNegativeSpan = Math.max(neutral.pitch - ext.pitchMin, calibration.pitchNegativeSpan || DEFAULT_PITCH_NEGATIVE_SPAN);

  const horizontal = clamp((neutral.x - sample.x) / horizontalSpan, -1.35, 1.35);

  const eyeNorm = normalizeSigned(sample.eyeVertical - neutral.eyeVertical, eyeNegativeSpan, eyePositiveSpan);
  const openNorm = normalizeSigned(sample.openness - neutral.openness, openNegativeSpan, openPositiveSpan);
  const pitchNorm = normalizeSigned(sample.pitch - neutral.pitch, pitchNegativeSpan, pitchPositiveSpan);

  let vertical = -eyeNorm * 1.05;

  if (Math.abs(eyeNorm) > 0.04) {
    if (Math.sign(openNorm) === Math.sign(eyeNorm) || Math.abs(openNorm) < 0.06) {
      vertical += -openNorm * 0.22;
    }
    if (Math.sign(pitchNorm) === Math.sign(eyeNorm) || Math.abs(pitchNorm) < 0.05) {
      vertical += -pitchNorm * 0.14;
    }
  } else {
    vertical += -openNorm * 0.10;
  }

  return { x: horizontal, y: clamp(vertical, -1.55, 1.55) };
}

function updateMovement(now) {
  const dt = clamp((now - lastFrameTime) / 16.67, 0.5, 2.2);
  lastFrameTime = now;

  if (state.controlActive && state.calibrated) {
    const mapped = mapSampleToAxes(filteredSample);
    const effectiveX = Math.abs(mapped.x) < DEADZONE_X ? 0 : mapped.x;
    const effectiveY = Math.abs(mapped.y) < DEADZONE_Y ? 0 : mapped.y;
    const boost = 2.4 + state.sensitivity * 0.55;
    const speedX = Math.abs(effectiveX) * boost * 1.08;
    const speedY = Math.abs(effectiveY) * boost * 1.02;

    cursorPosition.x = clamp(cursorPosition.x + effectiveX * speedX * dt, 18, window.innerWidth - 18);
    cursorPosition.y = clamp(cursorPosition.y + effectiveY * speedY * dt, 18, window.innerHeight - 18);
    clearDwell();
  } else {
    handleDwell(now);
  }

  updateCursorVisual();
}

function toggleMode() {
  if (!state.calibrated) {
    state.controlActive = false;
    return;
  }
  state.controlActive = !state.controlActive;
  clearDwell();
}

function updateBlink(now, landmarks) {
  const ratio = computeBlinkRatio(landmarks);
  const isClosed = state.blinkClosed ? ratio < BLINK_OPEN_RATIO : ratio < BLINK_CLOSE_RATIO;

  state.blinkClosed = isClosed;
  state.blinkText = isClosed ? 'Olhos fechados' : 'Olhos abertos';

  if (isClosed && !blinkStartTime) {
    blinkStartTime = now;
    blinkConsumed = false;
  }

  if (!isClosed) {
    blinkStartTime = 0;
    blinkConsumed = false;
    return;
  }

  if (!blinkConsumed && now - blinkStartTime >= LONG_BLINK_MS && now - lastToggleTime >= TOGGLE_COOLDOWN_MS) {
    blinkConsumed = true;
    lastToggleTime = now;
    state.blinkText = 'Piscada longa detectada';
    toggleMode();
  }
}

function resetNeutralCapture() {
  neutralCapture = {
    collecting: false,
    stableSince: 0,
    startedAt: 0,
    samples: [],
    autoStarted: false
  };
}

function prepareCalibrationSession(resetCursor = true) {
  clearStoredCalibration();
  resetNeutralCapture();
  if (resetCursor) {
    cursorPosition.x = window.innerWidth * 0.5;
    cursorPosition.y = window.innerHeight * 0.5;
    updateCursorVisual();
  }
}

function startNeutralCapture(now, autoStarted = false) {
  resetNeutralCapture();
  neutralCapture.collecting = true;
  neutralCapture.startedAt = now;
  neutralCapture.autoStarted = autoStarted;
  state.controlActive = false;
  state.calibrationText = 'Ajustando referência central';
  state.calibrationProgress = 0;
  updateOverlay({
    title: 'Ajuste inicial automático',
    description: 'Olhe para o centro do monitor por um instante. Direita e esquerda dependem só dos olhos. Cima e baixo usam os olhos como base e o rosto só como apoio leve.',
    progress: 0,
    badge: 'Ajustando',
    showTarget: true
  });
}

function finishNeutralCapture() {
  if (!neutralCapture || neutralCapture.samples.length < 10) {
    state.calibrationText = 'Rosto instável';
    state.calibrationProgress = 0;
    resetNeutralCapture();
    return;
  }

  const neutral = averageSample(neutralCapture.samples);
  const xSpread = Math.max(...neutralCapture.samples.map((sample) => Math.abs(sample.x - neutral.x)), 0.022);
  const eyeSpread = Math.max(...neutralCapture.samples.map((sample) => Math.abs(sample.eyeVertical - neutral.eyeVertical)), 0.03);
  const openSpread = Math.max(...neutralCapture.samples.map((sample) => Math.abs(sample.openness - neutral.openness)), 0.012);
  const pitchSpread = Math.max(...neutralCapture.samples.map((sample) => Math.abs(sample.pitch - neutral.pitch)), 0.02);

  state.calibrationData = {
    neutral,
    horizontalSpan: clamp(xSpread * 5.4, 0.075, 0.16),
    eyePositiveSpan: clamp(eyeSpread * 3.5, 0.09, 0.34),
    eyeNegativeSpan: clamp(eyeSpread * 3.5, 0.09, 0.34),
    openPositiveSpan: clamp(openSpread * 3.3, 0.02, 0.08),
    openNegativeSpan: clamp(openSpread * 3.3, 0.02, 0.08),
    pitchPositiveSpan: clamp(pitchSpread * 8.5, 0.08, 0.28),
    pitchNegativeSpan: clamp(pitchSpread * 8.5, 0.08, 0.28),
    extremes: {
      eyeMin: neutral.eyeVertical,
      eyeMax: neutral.eyeVertical,
      openMin: neutral.openness,
      openMax: neutral.openness,
      pitchMin: neutral.pitch,
      pitchMax: neutral.pitch
    }
  };

  state.calibrated = true;
  state.needsCalibration = false;
  state.calibrationText = 'Ajuste concluído';
  state.calibrationProgress = 100;
  saveStoredConfig();
  updateOverlay({
    title: 'Ajuste concluído',
    description: 'O cursor já pode ser usado. Se o vertical parecer fraco, olhe para cima e para baixo algumas vezes para o sistema ampliar o alcance nesta sessão.',
    progress: 100,
    badge: 'Pronto',
    showTarget: false
  });

  setTimeout(() => {
    hideOverlay();
  }, 900);

  resetNeutralCapture();
}

function maybeAutoCalibrate(now) {
  if (!state.cameraActive || !state.faceDetected || state.calibrated) return;
  if (!neutralCapture) resetNeutralCapture();

  if (!neutralCapture.collecting) {
    if (!neutralCapture.stableSince) neutralCapture.stableSince = now;
    const stableFor = now - neutralCapture.stableSince;
    const prepProgress = clamp((stableFor / AUTO_FACE_STABLE_MS) * 100, 0, 100);
    state.calibrationText = 'Centralizando rosto';
    state.calibrationProgress = prepProgress;
    updateOverlay({
      title: 'Preparando rastreamento',
      description: 'Centralize o rosto e olhe para o meio do monitor. Assim que estiver estável, o ajuste inicial começa sozinho.',
      progress: prepProgress,
      badge: 'Preparando',
      showTarget: true
    });
    if (stableFor >= AUTO_FACE_STABLE_MS) {
      startNeutralCapture(now, true);
    }
    return;
  }

  neutralCapture.samples.push({ ...currentRawSample });
  const progress = clamp(((now - neutralCapture.startedAt) / AUTO_CENTER_CALIBRATION_MS) * 100, 0, 100);
  state.calibrationText = 'Ajustando referência central';
  state.calibrationProgress = progress;
  updateOverlay({
    title: 'Ajuste inicial automático',
    description: 'Continue olhando para o centro. Depois, o sistema adapta melhor o vertical conforme você realmente olha para cima e para baixo durante o uso.',
    progress,
    badge: 'Lendo referência',
    showTarget: true
  });

  if (now - neutralCapture.startedAt >= AUTO_CENTER_CALIBRATION_MS) {
    finishNeutralCapture();
  }
}

function processLandmarks(landmarks, now) {
  const left = getEyeGeometry(landmarks, LEFT_EYE);
  const right = getEyeGeometry(landmarks, RIGHT_EYE);
  const raw = {
    x: (left.x + right.x) / 2,
    eyeVertical: (left.verticalBias + right.verticalBias) / 2,
    openness: (left.openness + right.openness) / 2,
    pitch: computeHeadPitchMetric(landmarks)
  };

  currentRawSample = raw;

  const blend = clamp(0.28 - state.smoothing * 0.02, 0.05, 0.2);
  filteredSample.x += (raw.x - filteredSample.x) * blend;
  filteredSample.eyeVertical += (raw.eyeVertical - filteredSample.eyeVertical) * Math.max(blend * 0.95, 0.04);
  filteredSample.openness += (raw.openness - filteredSample.openness) * Math.max(blend * 0.9, 0.035);
  filteredSample.pitch += (raw.pitch - filteredSample.pitch) * Math.max(blend * 0.6, 0.025);

  state.faceDetected = true;
  state.trackingText = 'Rosto detectado';
  if (placeholderEl) placeholderEl.classList.add('hidden');

  updateBlink(now, landmarks);
  maybeAutoCalibrate(now);
  if (state.calibrated) updateAdaptiveCalibration(filteredSample);
  updateMovement(now);
  emit();
}

function clearTracking(message = 'Aguardando rosto') {
  state.faceDetected = false;
  state.trackingText = message;
  state.blinkText = 'Olhos abertos';
  clearDwell();
  if (neutralCapture?.collecting) {
    resetNeutralCapture();
    state.calibrationText = 'Rosto perdido durante o ajuste';
    state.calibrationProgress = 0;
  } else if (neutralCapture) {
    neutralCapture.stableSince = 0;
  }
  emit();
}

async function ensureLandmarker() {
  if (faceLandmarker) return faceLandmarker;

  state.loading = true;
  state.trackingText = 'Carregando modelo';
  emit();

  const visionModule = await import(VISION_BUNDLE_URL);
  const filesetResolver = await visionModule.FilesetResolver.forVisionTasks(WASM_ROOT);
  faceLandmarker = await visionModule.FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: false,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  state.loading = false;
  emit();
  return faceLandmarker;
}

function detectionLoop() {
  if (!state.cameraActive || !videoEl || !faceLandmarker) return;

  const now = performance.now();
  if (videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoTime) {
    lastVideoTime = videoEl.currentTime;
    const result = faceLandmarker.detectForVideo(videoEl, now);
    const faceLandmarks = result?.faceLandmarks?.[0];

    if (faceLandmarks) {
      processLandmarks(faceLandmarks, now);
    } else {
      clearTracking('Rosto não encontrado');
      if (!state.calibrated) {
        updateOverlay({
          title: 'Posicione o rosto na câmera',
          description: 'O ajuste inicial automático começa sozinho assim que o rosto for detectado com estabilidade.',
          progress: 0,
          badge: 'Aguardando',
          showTarget: false
        });
      }
    }
  }

  rafId = requestAnimationFrame(detectionLoop);
}

function startLoop() {
  cancelAnimationFrame(rafId);
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(detectionLoop);
}

export async function initEyeControl() {
  videoEl = document.getElementById('camera-preview');
  cursorEl = document.getElementById('virtual-cursor');
  overlayEl = document.getElementById('calibration-overlay');
  targetEl = document.getElementById('calibration-target');
  progressBarEl = document.getElementById('calibration-progress-bar');
  titleEl = document.getElementById('calibration-title');
  descEl = document.getElementById('calibration-description');
  badgeEl = document.getElementById('calibration-step-badge');
  placeholderEl = document.getElementById('camera-placeholder');

  loadStoredConfig();
  ensureOverlayCloseButton();
  updateCursorVisual();
  prepareCalibrationSession(true);
  emit();

  window.addEventListener('resize', () => {
    cursorPosition.x = clamp(cursorPosition.x, 18, window.innerWidth - 18);
    cursorPosition.y = clamp(cursorPosition.y, 18, window.innerHeight - 18);
    updateCursorVisual();
  });
}

export async function requestCamera() {
  if (state.cameraActive) return;
  await ensureLandmarker();

  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });

  videoEl.srcObject = stream;
  await videoEl.play();
  state.cameraActive = true;
  state.trackingText = 'Aguardando rosto';
  prepareCalibrationSession(true);
  startLoop();
  updateOverlay({
    title: 'Preparando rastreamento',
    description: 'A câmera já está ligada. Centralize o rosto e olhe para o meio do monitor. O ajuste inicial vai começar sozinho.',
    progress: 0,
    badge: 'Câmera ativa',
    showTarget: true
  });
  emit();
}

export async function autoRequestCameraOnStart() {
  if (autoStartRequested || state.cameraActive) return;
  autoStartRequested = true;
  try {
    await requestCamera();
  } catch (error) {
    state.trackingText = 'Permissão de câmera necessária';
    emit();
    throw error;
  }
}

export function stopCamera() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  if (videoEl) videoEl.srcObject = null;
  state.cameraActive = false;
  state.controlActive = false;
  clearTracking('Câmera desligada');
  cancelAnimationFrame(rafId);
  prepareCalibrationSession(true);
  hideOverlay();
  if (placeholderEl) placeholderEl.classList.remove('hidden');
  emit();
}

export async function startCalibration() {
  if (!state.cameraActive) throw new Error('A câmera precisa estar ligada.');
  if (!state.faceDetected) throw new Error('Posicione o rosto na câmera primeiro.');
  prepareCalibrationSession(true);
  startNeutralCapture(performance.now(), false);
  emit();
}

export function toggleControlMode() {
  toggleMode();
  emit();
}

export function toggleCursorVisibility() {
  state.cursorVisible = !state.cursorVisible;
  if (!state.cursorVisible) clearDwell();
  updateCursorVisual();
  emit();
}

export function updateEyeConfig(partial) {
  if (typeof partial.sensitivity === 'number') state.sensitivity = clamp(partial.sensitivity, 1, 10);
  if (typeof partial.smoothing === 'number') state.smoothing = clamp(partial.smoothing, 1, 10);
  saveStoredConfig();
  emit();
}

export function subscribeEyeState(listener) {
  listeners.push(listener);
  listener(getEyeControlState());
  return () => {
    listeners = listeners.filter((item) => item !== listener);
  };
}

export function getEyeControlState() {
  return {
    ...state,
    dwellMs: state.dwellMs,
    targetLabel: state.targetLabel
  };
}
