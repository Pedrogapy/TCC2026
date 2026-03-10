const STORAGE_KEY = 'paa_eye_config_v5';
const LONG_BLINK_MS = 1400;
const TOGGLE_COOLDOWN_MS = 2200;
const DWELL_MS = 7000;
const DEADZONE_X = 0.09;
const DEADZONE_Y = 0.08;
const BLINK_CLOSE_RATIO = 0.105;
const BLINK_OPEN_RATIO = 0.155;
const AUTO_CENTER_CALIBRATION_MS = 2200;
const AUTO_FACE_STABLE_MS = 700;
const DEFAULT_HORIZONTAL_SPAN = 0.115;
const DEFAULT_EYE_VERTICAL_SPAN = 0.09;
const DEFAULT_PITCH_SPAN = 0.06;
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
  sensitivity: 3,
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
let faceLandmarker = null;
let stream = null;
let lastVideoTime = -1;
let lastFrameTime = performance.now();
let lastToggleTime = 0;
let blinkStartTime = 0;
let blinkConsumed = false;
let rafId = 0;
let filteredSample = { x: 0.5, y: 0.5, pitch: 0.5 };
let currentRawSample = { x: 0.5, y: 0.5, pitch: 0.5 };
let cursorPosition = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
let currentTarget = null;
let dwellStart = 0;
let neutralCapture = null;
let autoStartRequested = false;

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
  if (!samples.length) return { x: 0.5, y: 0.5, pitch: 0.5 };
  return {
    x: average(samples.map((sample) => sample.x)),
    y: average(samples.map((sample) => sample.y)),
    pitch: average(samples.map((sample) => sample.pitch))
  };
}

function loadStoredConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (typeof stored.sensitivity === 'number') state.sensitivity = clamp(stored.sensitivity, 1, 10);
    if (typeof stored.smoothing === 'number') state.smoothing = clamp(stored.smoothing, 1, 10);
    if (stored.calibrationData) {
      state.calibrationData = stored.calibrationData;
      state.calibrated = true;
      state.calibrationText = 'Ajuste salvo';
      state.needsCalibration = false;
      state.calibrationProgress = 100;
    }
  } catch {
    // ignore
  }
}

function saveStoredConfig() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sensitivity: state.sensitivity,
    smoothing: state.smoothing,
    calibrationData: state.calibrationData
  }));
}

function clearStoredCalibration() {
  state.calibrationData = null;
  state.calibrated = false;
  state.needsCalibration = true;
  state.calibrationText = 'Ajuste inicial pendente';
  state.calibrationProgress = 0;
  saveStoredConfig();
}

function normalizeIris(landmarks, eye) {
  const outer = landmarks[eye.outer];
  const inner = landmarks[eye.inner];
  const top = landmarks[eye.top];
  const bottom = landmarks[eye.bottom];
  const irisCenter = averagePoint(eye.iris.map((index) => landmarks[index]));

  const minX = Math.min(outer.x, inner.x);
  const maxX = Math.max(outer.x, inner.x);
  const minY = Math.min(top.y, bottom.y);
  const maxY = Math.max(top.y, bottom.y);

  return {
    x: clamp((irisCenter.x - minX) / Math.max(maxX - minX, 0.0001), 0, 1),
    y: clamp((irisCenter.y - minY) / Math.max(maxY - minY, 0.0001), 0, 1)
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
  return clamp((nose.y - forehead.y) / Math.max(chin.y - forehead.y, 0.0001), 0, 1);
}

function updateCursorVisual() {
  if (!cursorEl) return;
  cursorEl.style.left = `${cursorPosition.x}px`;
  cursorEl.style.top = `${cursorPosition.y}px`;
  cursorEl.classList.toggle('hidden', !state.cursorVisible);
  cursorEl.classList.toggle('paused', !state.controlActive);
  cursorEl.classList.toggle('is-dwell', Boolean(currentTarget));
}

function updateOverlay({ title, description, progress = 0, badge = 'Preparando', showTarget = false }) {
  if (!overlayEl) return;
  overlayEl.classList.remove('hidden');
  titleEl.textContent = title;
  descEl.textContent = description;
  badgeEl.textContent = badge;
  progressBarEl.style.width = `${clamp(progress, 0, 100)}%`;
  targetEl.classList.toggle('hidden', !showTarget);
}

function hideOverlay() {
  if (!overlayEl) return;
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

function mapSampleToAxes(sample) {
  const calibration = state.calibrationData;
  if (!calibration?.neutral) return { x: 0, y: 0 };

  const neutral = calibration.neutral;
  const horizontalSpan = calibration.horizontalSpan || DEFAULT_HORIZONTAL_SPAN;
  const eyeVerticalSpan = calibration.eyeVerticalSpan || DEFAULT_EYE_VERTICAL_SPAN;
  const pitchSpan = calibration.pitchSpan || DEFAULT_PITCH_SPAN;

  const horizontal = clamp((neutral.x - sample.x) / horizontalSpan, -1.35, 1.35);
  const eyeVertical = clamp((sample.y - neutral.y) / eyeVerticalSpan, -1.35, 1.35);
  const headVertical = clamp((sample.pitch - neutral.pitch) / pitchSpan, -1.2, 1.2);
  const vertical = clamp((eyeVertical * 0.82) + (headVertical * 0.35), -1.4, 1.4);

  return { x: horizontal, y: vertical };
}

function updateMovement(now) {
  const dt = clamp((now - lastFrameTime) / 16.67, 0.5, 2.2);
  lastFrameTime = now;

  if (state.controlActive && state.calibrated) {
    const mapped = mapSampleToAxes(filteredSample);
    const effectiveX = Math.abs(mapped.x) < DEADZONE_X ? 0 : mapped.x;
    const effectiveY = Math.abs(mapped.y) < DEADZONE_Y ? 0 : mapped.y;
    const boost = 4.4 + state.sensitivity * 1.15;
    const speedX = Math.abs(effectiveX) * boost * 1.5;
    const speedY = Math.abs(effectiveY) * boost * 1.38;

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
    description: 'Olhe para o centro do monitor por um instante. Direita/esquerda usam apenas os olhos. Cima/baixo usam olhos + leve inclinação do rosto.',
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
  const xSpread = Math.max(...neutralCapture.samples.map((sample) => Math.abs(sample.x - neutral.x)), 0.025);
  const ySpread = Math.max(...neutralCapture.samples.map((sample) => Math.abs(sample.y - neutral.y)), 0.02);
  const pitchSpread = Math.max(...neutralCapture.samples.map((sample) => Math.abs(sample.pitch - neutral.pitch)), 0.015);

  state.calibrationData = {
    neutral,
    horizontalSpan: clamp(xSpread * 5.8, 0.08, 0.16),
    eyeVerticalSpan: clamp(ySpread * 6.8, 0.06, 0.14),
    pitchSpan: clamp(pitchSpread * 7.2, 0.04, 0.09)
  };
  state.calibrated = true;
  state.needsCalibration = false;
  state.calibrationText = 'Ajuste concluído';
  state.calibrationProgress = 100;
  saveStoredConfig();
  updateOverlay({
    title: 'Ajuste concluído',
    description: 'Agora direita/esquerda seguem principalmente os olhos, e cima/baixo combinam olhos com a inclinação do rosto.',
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
      description: 'Centralize o rosto. Assim que estiver estável, o ajuste inicial começa sozinho.',
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
    description: 'Continue olhando para o centro. O sistema está aprendendo sua referência neste monitor.',
    progress,
    badge: 'Lendo referência',
    showTarget: true
  });

  if (now - neutralCapture.startedAt >= AUTO_CENTER_CALIBRATION_MS) {
    finishNeutralCapture();
  }
}

function processLandmarks(landmarks, now) {
  const left = normalizeIris(landmarks, LEFT_EYE);
  const right = normalizeIris(landmarks, RIGHT_EYE);
  const raw = {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    pitch: computeHeadPitchMetric(landmarks)
  };

  currentRawSample = raw;

  const blend = clamp(0.28 - state.smoothing * 0.02, 0.05, 0.2);
  filteredSample.x += (raw.x - filteredSample.x) * blend;
  filteredSample.y += (raw.y - filteredSample.y) * blend;
  filteredSample.pitch += (raw.pitch - filteredSample.pitch) * Math.max(blend * 0.82, 0.04);

  state.faceDetected = true;
  state.trackingText = 'Rosto detectado';
  if (placeholderEl) placeholderEl.classList.add('hidden');

  updateBlink(now, landmarks);
  maybeAutoCalibrate(now);
  updateMovement(now);
  emit();
}

function clearTracking(message = 'Aguardando rosto') {
  state.faceDetected = false;
  state.trackingText = message;
  state.blinkText = 'Olhos abertos';
  clearDwell();
  if (neutralCapture && !neutralCapture.collecting) neutralCapture.stableSince = 0;
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
  updateCursorVisual();
  resetNeutralCapture();
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
  startLoop();
  updateOverlay({
    title: 'Preparando rastreamento',
    description: 'A câmera já está ligada. Centralize o rosto e o ajuste inicial vai começar sozinho.',
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
  resetNeutralCapture();
  hideOverlay();
  if (placeholderEl) placeholderEl.classList.remove('hidden');
  emit();
}

export async function startCalibration() {
  if (!state.cameraActive) throw new Error('A câmera precisa estar ligada.');
  if (!state.faceDetected) throw new Error('Posicione o rosto na câmera primeiro.');
  clearStoredCalibration();
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
