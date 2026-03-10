
const STORAGE_KEY = 'paa_eye_config_v7';
const LONG_BLINK_MS = 1700;
const TOGGLE_COOLDOWN_MS = 2400;
const DWELL_MS = 7000;
const DEFAULT_SENSITIVITY = 3;
const DEFAULT_SMOOTHING = 8;
const BLINK_CLOSE_RATIO = 0.105;
const BLINK_OPEN_RATIO = 0.16;
const WARMUP_MIN_VALID_SAMPLES = 18;
const WARMUP_MIN_MS = 1800;
const CURSOR_MARGIN = 18;
const VISION_BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs';
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const BLINK_POINTS = {
  left: { top: 159, bottom: 145, outer: 33, inner: 133 },
  right: { top: 386, bottom: 374, outer: 362, inner: 263 }
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
  calibrationText: 'Preparando WebGazer',
  calibrationProgress: 0,
  sensitivity: DEFAULT_SENSITIVITY,
  smoothing: DEFAULT_SMOOTHING,
  dwellMs: 0,
  targetLabel: 'Nenhum alvo',
  needsCalibration: true
};

let listeners = [];
let previewEl;
let cursorEl;
let overlayEl;
let targetEl;
let progressBarEl;
let titleEl;
let descEl;
let badgeEl;
let placeholderEl;
let faceLandmarker = null;
let mediaVideoEl = null;
let webgazerInstance = null;
let webgazerReady = false;
let latestPrediction = null;
let filteredTarget = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
let cursorPosition = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
let currentTarget = null;
let dwellStart = 0;
let lastBlinkToggleTime = 0;
let blinkStartTime = 0;
let blinkConsumed = false;
let detectRafId = 0;
let lastVideoTime = -1;
let calibrationStartedAt = 0;
let validPredictionCount = 0;

function emit() {
  listeners.forEach((listener) => listener(getEyeControlState()));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
  overlayEl?.classList.add('hidden');
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

function resetTrainingState(resetCursor = true) {
  state.calibrated = false;
  state.needsCalibration = true;
  state.controlActive = false;
  state.calibrationText = 'Preparando WebGazer';
  state.calibrationProgress = 0;
  calibrationStartedAt = performance.now();
  validPredictionCount = 0;
  latestPrediction = null;
  filteredTarget = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
  if (resetCursor) {
    cursorPosition = { ...filteredTarget };
    updateCursorVisual();
  }
  clearDwell();
  updateOverlay({
    title: 'Preparando rastreamento',
    description: 'O cursor agora usa WebGazer como motor principal. Faça alguns cliques olhando para botões do site para ele se ajustar melhor nesta sessão.',
    progress: 0,
    badge: 'Aquecendo',
    showTarget: false
  });
}

function markReady() {
  state.calibrated = true;
  state.needsCalibration = false;
  state.calibrationText = 'Rastreamento pronto';
  state.calibrationProgress = 100;
  updateOverlay({
    title: 'Rastreamento pronto',
    description: 'O WebGazer já está gerando previsões. Mais cliques no sistema ajudam a precisão durante a sessão.',
    progress: 100,
    badge: 'Pronto',
    showTarget: false
  });
  setTimeout(hideOverlay, 900);
}

function handlePredictionWarmup(now) {
  if (!latestPrediction) {
    state.calibrationText = 'Aguardando previsão de olhar';
    state.calibrationProgress = 0;
    updateOverlay({
      title: 'Preparando rastreamento',
      description: 'Mantenha o rosto visível na câmera e olhe para a tela. Se puder, faça alguns cliques olhando para os botões do portal.',
      progress: 0,
      badge: 'Aguardando',
      showTarget: false
    });
    return;
  }

  if (!state.faceDetected) {
    state.calibrationText = 'Rosto não encontrado';
    state.calibrationProgress = 0;
    updateOverlay({
      title: 'Posicione o rosto na câmera',
      description: 'O WebGazer precisa ver seu rosto para começar a prever o olhar na tela.',
      progress: 0,
      badge: 'Sem rosto',
      showTarget: false
    });
    return;
  }

  validPredictionCount += 1;
  const timeProgress = clamp(((now - calibrationStartedAt) / WARMUP_MIN_MS) * 100, 0, 100);
  const sampleProgress = clamp((validPredictionCount / WARMUP_MIN_VALID_SAMPLES) * 100, 0, 100);
  const progress = Math.min(timeProgress, sampleProgress);
  state.calibrationText = 'Aquecendo previsões do WebGazer';
  state.calibrationProgress = progress;
  updateOverlay({
    title: 'Aquecendo previsões',
    description: 'Continue olhando para a tela. Clicar olhando para elementos do portal ajuda o WebGazer a aprender mais rápido nesta sessão.',
    progress,
    badge: 'Treinando',
    showTarget: false
  });

  if (now - calibrationStartedAt >= WARMUP_MIN_MS && validPredictionCount >= WARMUP_MIN_VALID_SAMPLES) {
    markReady();
  }
}

function updateMovement(now) {
  if (!state.calibrated || !latestPrediction) {
    handleDwell(now);
    updateCursorVisual();
    return;
  }

  const viewportX = clamp(latestPrediction.x, CURSOR_MARGIN, window.innerWidth - CURSOR_MARGIN);
  const viewportY = clamp(latestPrediction.y, CURSOR_MARGIN, window.innerHeight - CURSOR_MARGIN);
  const smoothFactor = clamp(0.1 + (11 - state.smoothing) * 0.035, 0.08, 0.38);
  const sensitivityFactor = clamp(0.82 + state.sensitivity * 0.05, 0.87, 1.32);

  filteredTarget.x += (viewportX - filteredTarget.x) * smoothFactor;
  filteredTarget.y += (viewportY - filteredTarget.y) * smoothFactor;

  if (state.controlActive) {
    cursorPosition.x += (filteredTarget.x - cursorPosition.x) * clamp(smoothFactor * sensitivityFactor, 0.08, 0.42);
    cursorPosition.y += (filteredTarget.y - cursorPosition.y) * clamp(smoothFactor * sensitivityFactor, 0.08, 0.42);
    cursorPosition.x = clamp(cursorPosition.x, CURSOR_MARGIN, window.innerWidth - CURSOR_MARGIN);
    cursorPosition.y = clamp(cursorPosition.y, CURSOR_MARGIN, window.innerHeight - CURSOR_MARGIN);
    clearDwell();
  } else {
    handleDwell(now);
  }

  updateCursorVisual();
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

  if (!blinkConsumed && now - blinkStartTime >= LONG_BLINK_MS && now - lastBlinkToggleTime >= TOGGLE_COOLDOWN_MS) {
    blinkConsumed = true;
    lastBlinkToggleTime = now;
    state.blinkText = 'Piscada longa detectada';
    toggleMode();
  }
}

async function ensureFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker;

  state.loading = true;
  state.trackingText = 'Carregando MediaPipe';
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
  return faceLandmarker;
}

function getWebgazerGlobal() {
  return window.webgazer || window.webgazer?.default || null;
}

function hideWebgazerUi() {
  ['webgazerVideoFeed', 'webgazerVideoCanvas', 'webgazerFaceOverlay', 'webgazerFaceFeedbackBox'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.style.pointerEvents = 'none';
    }
  });
}

async function attachWebgazerFeedToPreview() {
  const internalVideo = document.getElementById('webgazerVideoFeed');
  if (!internalVideo) return;
  mediaVideoEl = internalVideo;
  hideWebgazerUi();

  const stream = internalVideo.srcObject;
  if (previewEl && stream && previewEl.srcObject !== stream) {
    previewEl.srcObject = stream;
    try {
      await previewEl.play();
    } catch {
      // ignore autoplay issues; video is muted
    }
  }

  if (placeholderEl) placeholderEl.classList.add('hidden');
}

async function startWebgazerEngine() {
  const webgazer = getWebgazerGlobal();
  if (!webgazer) throw new Error('A biblioteca WebGazer não carregou.');

  webgazerInstance = webgazer;

  try {
    webgazer.clearData?.();
  } catch {
    // ignore
  }

  try {
    webgazer.setRegression?.('weightedRidge');
  } catch {
    // ignore
  }

  try {
    webgazer.setTracker?.('TFFacemesh');
  } catch {
    // ignore
  }

  webgazer
    .setGazeListener((data) => {
      if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') {
        latestPrediction = null;
        return;
      }

      latestPrediction = {
        x: clamp(data.x, CURSOR_MARGIN, window.innerWidth - CURSOR_MARGIN),
        y: clamp(data.y, CURSOR_MARGIN, window.innerHeight - CURSOR_MARGIN)
      };
    });

  const instance = await webgazer.begin();
  instance?.showPredictionPoints?.(false);
  instance?.showVideoPreview?.(false);
  instance?.showFaceOverlay?.(false);
  instance?.showFaceFeedbackBox?.(false);
  webgazerReady = true;

  const feedReadyStart = performance.now();
  while (!document.getElementById('webgazerVideoFeed')) {
    if (performance.now() - feedReadyStart > 4000) break;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  await attachWebgazerFeedToPreview();
}

function mediaPipeLoop() {
  if (!state.cameraActive || !faceLandmarker || !mediaVideoEl) return;

  const now = performance.now();

  if (mediaVideoEl.readyState >= 2 && mediaVideoEl.currentTime !== lastVideoTime) {
    lastVideoTime = mediaVideoEl.currentTime;
    const result = faceLandmarker.detectForVideo(mediaVideoEl, now);
    const landmarks = result?.faceLandmarks?.[0];

    if (landmarks) {
      state.faceDetected = true;
      state.trackingText = latestPrediction ? 'WebGazer prevendo olhar' : 'Rosto detectado';
      updateBlink(now, landmarks);
    } else {
      state.faceDetected = false;
      state.trackingText = 'Rosto não encontrado';
      state.blinkText = 'Olhos abertos';
      blinkStartTime = 0;
      blinkConsumed = false;
    }
  }

  if (!state.calibrated) {
    handlePredictionWarmup(now);
  }

  updateMovement(now);
  emit();
  detectRafId = requestAnimationFrame(mediaPipeLoop);
}

function startLoops() {
  cancelAnimationFrame(detectRafId);
  detectRafId = requestAnimationFrame(mediaPipeLoop);
}

export async function initEyeControl() {
  previewEl = document.getElementById('camera-preview');
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
  resetTrainingState(true);
  emit();

  window.addEventListener('resize', () => {
    cursorPosition.x = clamp(cursorPosition.x, CURSOR_MARGIN, window.innerWidth - CURSOR_MARGIN);
    cursorPosition.y = clamp(cursorPosition.y, CURSOR_MARGIN, window.innerHeight - CURSOR_MARGIN);
    filteredTarget.x = clamp(filteredTarget.x, CURSOR_MARGIN, window.innerWidth - CURSOR_MARGIN);
    filteredTarget.y = clamp(filteredTarget.y, CURSOR_MARGIN, window.innerHeight - CURSOR_MARGIN);
    updateCursorVisual();
  });
}

export async function requestCamera() {
  if (state.cameraActive && webgazerReady) return;
  await ensureFaceLandmarker();
  state.loading = true;
  state.trackingText = 'Ligando câmera pelo WebGazer';
  emit();

  await startWebgazerEngine();

  state.loading = false;
  state.cameraActive = true;
  state.trackingText = 'Aguardando rosto';
  state.blinkText = 'Olhos abertos';
  resetTrainingState(true);
  startLoops();
  emit();
}

export async function autoRequestCameraOnStart() {
  try {
    await requestCamera();
  } catch (error) {
    state.trackingText = 'Permissão de câmera necessária';
    emit();
    throw error;
  }
}

export function stopCamera() {
  cancelAnimationFrame(detectRafId);

  try {
    webgazerInstance?.pause?.();
    webgazerInstance?.end?.();
  } catch {
    // ignore
  }

  webgazerReady = false;
  webgazerInstance = null;
  latestPrediction = null;
  mediaVideoEl = null;
  if (previewEl) previewEl.srcObject = null;
  state.cameraActive = false;
  state.faceDetected = false;
  state.controlActive = false;
  state.trackingText = 'Câmera desligada';
  state.blinkText = 'Olhos abertos';
  resetTrainingState(true);
  hideOverlay();
  if (placeholderEl) placeholderEl.classList.remove('hidden');
  emit();
}

export async function startCalibration() {
  if (!state.cameraActive || !webgazerInstance) throw new Error('A câmera precisa estar ligada.');
  try {
    webgazerInstance.clearData?.();
    webgazerInstance.resume?.();
  } catch {
    // ignore
  }
  resetTrainingState(true);
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
