const STORAGE_KEY = 'paa_eye_config_v3';
const LONG_BLINK_MS = 1050;
const TOGGLE_COOLDOWN_MS = 1800;
const DWELL_MS = 7000;
const DEADZONE = 0.12;
const BLINK_CLOSE_RATIO = 0.12;
const BLINK_OPEN_RATIO = 0.165;
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

const calibrationSteps = [
  { key: 'neutral', title: 'Centro', description: 'Olhe para o centro do monitor sem mover a cabeça.', target: { x: 50, y: 50 } },
  { key: 'left', title: 'Esquerda', description: 'Olhe o máximo que conseguir para a esquerda.', target: { x: 18, y: 50 } },
  { key: 'right', title: 'Direita', description: 'Olhe o máximo que conseguir para a direita.', target: { x: 82, y: 50 } },
  { key: 'up', title: 'Cima', description: 'Olhe para cima. Pode inclinar levemente o rosto se isso ajudar.', target: { x: 50, y: 18 } },
  { key: 'down', title: 'Baixo', description: 'Olhe para baixo. Pode inclinar levemente o rosto se isso ajudar.', target: { x: 50, y: 82 } }
];

const state = {
  loading: false,
  cameraActive: false,
  faceDetected: false,
  trackingText: 'Aguardando câmera',
  blinkText: 'Olhos abertos',
  blinkClosed: false,
  controlActive: false,
  cursorVisible: false,
  calibrated: false,
  calibrationText: 'Pendente',
  calibrationProgress: 0,
  sensitivity: 6,
  smoothing: 6,
  dwellMs: 0,
  targetLabel: 'Nenhum alvo',
  calibrationData: null,
  needsCalibration: true
};

let videoEl;
let cursorEl;
let overlayEl;
let targetEl;
let progressBarEl;
let titleEl;
let descEl;
let badgeEl;

let listeners = [];
let faceLandmarker = null;
let stream = null;
let lastVideoTime = -1;
let lastFrameTime = performance.now();
let lastToggleTime = 0;
let blinkStartTime = 0;
let blinkConsumed = false;
let rafId = 0;
let filteredGaze = { x: 0.5, y: 0.5, pitch: 0.5 };
let cursorPosition = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
let currentTarget = null;
let dwellStart = 0;
let calibrationSession = null;
let currentRawSample = { x: 0.5, y: 0.5, pitch: 0.5 };

function emit() {
  listeners.forEach((listener) => listener(getEyeControlState()));
}

function loadStoredConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (typeof stored.sensitivity === 'number') {
      state.sensitivity = clamp(stored.sensitivity, 1, 10);
    }
    if (typeof stored.smoothing === 'number') {
      state.smoothing = clamp(stored.smoothing, 1, 10);
    }
    if (stored.calibrationData) {
      state.calibrationData = stored.calibrationData;
      state.calibrated = true;
      state.calibrationText = 'Concluída';
      state.needsCalibration = false;
    }
  } catch {
    // ignore invalid storage
  }
}

function saveStoredConfig() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      sensitivity: state.sensitivity,
      smoothing: state.smoothing,
      calibrationData: state.calibrationData
    })
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averagePoint(points) {
  if (!points.length) {
    return { x: 0.5, y: 0.5 };
  }

  return {
    x: average(points.map((point) => point.x)),
    y: average(points.map((point) => point.y))
  };
}

function averageSample(samples) {
  if (!samples.length) {
    return { x: 0.5, y: 0.5, pitch: 0.5 };
  }

  return {
    x: average(samples.map((sample) => sample.x)),
    y: average(samples.map((sample) => sample.y)),
    pitch: average(samples.map((sample) => sample.pitch))
  };
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
  if (!cursorEl) {
    return;
  }

  cursorEl.style.left = `${cursorPosition.x}px`;
  cursorEl.style.top = `${cursorPosition.y}px`;
  cursorEl.classList.toggle('hidden', !state.cursorVisible);
  cursorEl.classList.toggle('paused', !state.controlActive);
  cursorEl.classList.toggle('is-dwell', Boolean(currentTarget));
}

function updateOverlay(target, title, description, progress, badge) {
  if (!overlayEl) {
    return;
  }

  targetEl.style.left = `${target.x}%`;
  targetEl.style.top = `${target.y}%`;
  titleEl.textContent = title;
  descEl.textContent = description;
  badgeEl.textContent = badge;
  progressBarEl.style.width = `${progress}%`;
}

function clearDwell() {
  if (currentTarget) {
    currentTarget.classList.remove('is-dwell');
  }
  currentTarget = null;
  dwellStart = 0;
  state.dwellMs = 0;
}

function isClickable(element) {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    element.closest(
      'button, a, input, select, textarea, [data-eye-click], [role="button"], .nav-button, .btn, .test-target'
    )
  );
}

function handleDwell(now) {
  if (state.controlActive || !state.cursorVisible) {
    clearDwell();
    emit();
    return;
  }

  const element = document.elementFromPoint(cursorPosition.x, cursorPosition.y);
  const clickable = element?.closest(
    'button, a, input, select, textarea, [data-eye-click], [role="button"], .nav-button, .btn, .test-target'
  );

  if (!isClickable(clickable)) {
    clearDwell();
    emit();
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

  emit();
}

function toggleMode() {
  if (!state.calibrated) {
    state.controlActive = false;
    emit();
    return;
  }

  state.controlActive = !state.controlActive;
  clearDwell();
  emit();
}

function mapGazeToAxes(sample) {
  const calibration = state.calibrationData;
  if (!calibration) {
    return { x: 0, y: 0 };
  }

  const neutral = calibration.neutral;
  const leftSpan = Math.max(neutral.x - calibration.left.x, 0.02);
  const rightSpan = Math.max(calibration.right.x - neutral.x, 0.02);
  const upSpan = Math.max(neutral.y - calibration.up.y, 0.02);
  const downSpan = Math.max(calibration.down.y - neutral.y, 0.02);

  const pitchNeutral = neutral.pitch ?? 0.5;
  const pitchUpSpan = Math.max(pitchNeutral - (calibration.up.pitch ?? pitchNeutral), 0.015);
  const pitchDownSpan = Math.max((calibration.down.pitch ?? pitchNeutral) - pitchNeutral, 0.015);

  let x = 0;
  let yEye = 0;
  let yPitch = 0;

  if (sample.x < neutral.x) {
    x = -((neutral.x - sample.x) / leftSpan);
  } else {
    x = (sample.x - neutral.x) / rightSpan;
  }

  if (sample.y < neutral.y) {
    yEye = -((neutral.y - sample.y) / upSpan);
  } else {
    yEye = (sample.y - neutral.y) / downSpan;
  }

  const currentPitch = sample.pitch ?? pitchNeutral;
  if (currentPitch < pitchNeutral) {
    yPitch = -((pitchNeutral - currentPitch) / pitchUpSpan);
  } else {
    yPitch = (currentPitch - pitchNeutral) / pitchDownSpan;
  }

  const vertical = clamp((yEye * 0.72) + (yPitch * 0.38), -1.35, 1.35);

  return {
    x: clamp(x, -1.25, 1.25),
    y: vertical
  };
}

function updateMovement(now) {
  const dt = clamp((now - lastFrameTime) / 16.67, 0.5, 2.2);
  lastFrameTime = now;

  if (state.controlActive && state.calibrated) {
    const mapped = mapGazeToAxes(filteredGaze);
    const effectiveX = Math.abs(mapped.x) < DEADZONE ? 0 : mapped.x;
    const effectiveY = Math.abs(mapped.y) < DEADZONE ? 0 : mapped.y;

    const boost = 7 + state.sensitivity * 2.2;
    const speedX = Math.abs(effectiveX) * boost * 2.3;
    const speedY = Math.abs(effectiveY) * boost * 2.1;

    cursorPosition.x = clamp(cursorPosition.x + effectiveX * speedX * dt, 18, window.innerWidth - 18);
    cursorPosition.y = clamp(cursorPosition.y + effectiveY * speedY * dt, 18, window.innerHeight - 18);
    clearDwell();
  } else {
    handleDwell(now);
  }

  updateCursorVisual();
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

function feedCalibrationSample() {
  if (!calibrationSession || !calibrationSession.collecting) {
    return;
  }

  calibrationSession.samples.push({ ...currentRawSample });
}

function processLandmarks(landmarks, now) {
  const left = normalizeIris(landmarks, LEFT_EYE);
  const right = normalizeIris(landmarks, RIGHT_EYE);
  const headPitch = computeHeadPitchMetric(landmarks);
  const raw = {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    pitch: headPitch
  };

  currentRawSample = raw;

  const blend = clamp(0.28 - state.smoothing * 0.02, 0.05, 0.2);
  filteredGaze.x += (raw.x - filteredGaze.x) * blend;
  filteredGaze.y += (raw.y - filteredGaze.y) * blend;
  filteredGaze.pitch += (raw.pitch - filteredGaze.pitch) * Math.max(blend * 0.85, 0.04);

  state.faceDetected = true;
  state.trackingText = 'Rosto detectado';

  updateBlink(now, landmarks);
  feedCalibrationSample();
  updateMovement(now);
  emit();
}

function clearTracking(message = 'Aguardando rosto') {
  state.faceDetected = false;
  state.trackingText = message;
  state.blinkText = 'Olhos abertos';
  clearDwell();
  emit();
}

async function ensureLandmarker() {
  if (faceLandmarker) {
    return faceLandmarker;
  }

  state.loading = true;
  state.trackingText = 'Carregando modelo';
  emit();

  const visionModule = await import(VISION_BUNDLE_URL);
  const filesetResolver = await visionModule.FilesetResolver.forVisionTasks(WASM_ROOT);

  faceLandmarker = await visionModule.FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU'
    },
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
  if (!state.cameraActive || !videoEl || !faceLandmarker) {
    return;
  }

  const now = performance.now();

  if (videoEl.readyState >= 2 && videoEl.currentTime !== lastVideoTime) {
    lastVideoTime = videoEl.currentTime;

    const result = faceLandmarker.detectForVideo(videoEl, now);
    const faceLandmarks = result?.faceLandmarks?.[0];

    if (faceLandmarks) {
      processLandmarks(faceLandmarks, now);
    } else {
      clearTracking('Rosto não encontrado');
    }
  }

  rafId = requestAnimationFrame(detectionLoop);
}

function startLoop() {
  cancelAnimationFrame(rafId);
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(detectionLoop);
}

async function runCalibrationStep(stepIndex) {
  const step = calibrationSteps[stepIndex];
  calibrationSession.stageIndex = stepIndex;
  calibrationSession.samples = [];
  calibrationSession.collecting = false;
  state.calibrationText = `Calibrando: ${step.title}`;
  state.calibrationProgress = (stepIndex / calibrationSteps.length) * 100;
  emit();

  updateOverlay(step.target, step.title, step.description, state.calibrationProgress, `Etapa ${stepIndex + 1} de ${calibrationSteps.length}`);
  await wait(900);

  calibrationSession.collecting = true;
  const startedAt = performance.now();
  const duration = 1200;

  while (performance.now() - startedAt < duration) {
    const localProgress = ((stepIndex + (performance.now() - startedAt) / duration) / calibrationSteps.length) * 100;
    state.calibrationProgress = clamp(localProgress, 0, 100);
    progressBarEl.style.width = `${state.calibrationProgress}%`;
    await wait(80);
  }

  calibrationSession.collecting = false;

  if (calibrationSession.samples.length < 6) {
    throw new Error('A câmera não conseguiu coletar dados suficientes.');
  }

  calibrationSession.points[step.key] = averageSample(calibrationSession.samples);
}

async function finalizeCalibration() {
  const data = calibrationSession.points;
  state.calibrationData = data;
  state.calibrated = true;
  state.needsCalibration = false;
  state.calibrationText = 'Concluída';
  state.calibrationProgress = 100;
  saveStoredConfig();
  emit();
  await wait(400);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  loadStoredConfig();
  state.cursorVisible = true;
  cursorPosition = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
  updateCursorVisual();
  emit();

  window.addEventListener('resize', () => {
    cursorPosition.x = clamp(cursorPosition.x, 18, window.innerWidth - 18);
    cursorPosition.y = clamp(cursorPosition.y, 18, window.innerHeight - 18);
    updateCursorVisual();
  });
}

export async function requestCamera() {
  if (state.cameraActive) {
    return;
  }

  await ensureLandmarker();

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  videoEl.srcObject = stream;
  await videoEl.play();
  state.cameraActive = true;
  state.trackingText = 'Aguardando rosto';
  startLoop();
  emit();
}

export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }

  stream = null;
  if (videoEl) {
    videoEl.srcObject = null;
  }

  state.cameraActive = false;
  state.controlActive = false;
  clearTracking('Câmera desligada');
  cancelAnimationFrame(rafId);
  emit();
}

export async function startCalibration() {
  if (!state.cameraActive) {
    throw new Error('Ative a webcam antes de calibrar.');
  }

  if (!state.faceDetected) {
    throw new Error('Aproxime o rosto da câmera e tente novamente.');
  }

  state.controlActive = false;
  state.cursorVisible = false;
  clearDwell();
  calibrationSession = {
    stageIndex: 0,
    collecting: false,
    samples: [],
    points: {}
  };

  overlayEl.classList.remove('hidden');
  emit();

  try {
    for (let index = 0; index < calibrationSteps.length; index += 1) {
      await runCalibrationStep(index);
    }

    await finalizeCalibration();
    updateOverlay({ x: 50, y: 50 }, 'Calibração concluída', 'Agora o sistema usa olhos e uma leve inclinação do rosto para reforçar cima e baixo neste monitor.', 100, 'Concluído');
    await wait(900);
  } finally {
    overlayEl.classList.add('hidden');
    state.cursorVisible = true;
    calibrationSession = null;
    updateCursorVisual();
    emit();
  }
}

export function toggleControlMode() {
  toggleMode();
}

export function toggleCursorVisibility() {
  state.cursorVisible = !state.cursorVisible;
  if (!state.cursorVisible) {
    clearDwell();
  }
  updateCursorVisual();
  emit();
}

export function updateEyeConfig(partial) {
  if (typeof partial.sensitivity === 'number') {
    state.sensitivity = clamp(partial.sensitivity, 1, 10);
  }
  if (typeof partial.smoothing === 'number') {
    state.smoothing = clamp(partial.smoothing, 1, 10);
  }
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
