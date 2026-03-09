import { getConfig, saveConfig } from './storage.js';

const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs';
const TASKS_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const DWELL_TIME_MS = 7000;
const LONG_BLINK_MS = 700;
const TOGGLE_COOLDOWN_MS = 1400;
const DEADZONE = 0.018;

const LEFT_EYE_INDICES = [33, 133, 159, 145, 160, 144, 158, 153];
const RIGHT_EYE_INDICES = [362, 263, 386, 374, 385, 380, 387, 373];
const LEFT_IRIS_INDICES = [468, 469, 470, 471, 472];
const RIGHT_IRIS_INDICES = [473, 474, 475, 476, 477];

let mediaStream = null;
let faceLandmarker = null;
let filesetResolver = null;
let visionModule = null;
let cursorElement = null;
let videoElement = null;
let placeholderElement = null;
let animationFrameId = null;
let lastVideoTime = -1;
let lastFrameStamp = performance.now();
let blinkStartTime = 0;
let lastToggleTime = 0;
let blinkConsumed = false;
let baselinePending = true;
let hoveredTarget = null;
let dwellStartTime = 0;
let hoverOutlineElement = null;
const subscribers = [];

const storedConfig = getConfig();
const eyeState = {
  loading: false,
  cameraActive: false,
  cameraReady: false,
  faceDetected: false,
  controlMode: storedConfig.controlMode || 'paused',
  cursorVisible: Boolean(storedConfig.cursorVisible),
  gazeX: 0.5,
  gazeY: 0.5,
  blinkClosed: false,
  dwellProgress: 0,
  sensitivity: Number(storedConfig.sensitivity || 6),
  dwellTime: DWELL_TIME_MS,
  smoothing: Number(storedConfig.smoothing || 7),
  trackingMessage: 'Aguardando webcam',
  baseline: null
};

let currentPosition = {
  x: window.innerWidth * 0.52,
  y: window.innerHeight * 0.52
};

let filteredGaze = {
  x: 0.5,
  y: 0.5
};

function notifyState() {
  subscribers.forEach((listener) => listener({ ...eyeState }));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0));
}

function averagePoint(landmarks, indices) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean);
  const total = points.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 }
  );

  return {
    x: total.x / points.length,
    y: total.y / points.length
  };
}

function getEyeBounds(landmarks, indices) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y))
  };
}

function normalizeIrisPosition(landmarks, eyeIndices, irisIndices) {
  const iris = averagePoint(landmarks, irisIndices);
  const bounds = getEyeBounds(landmarks, eyeIndices);
  const width = Math.max(bounds.maxX - bounds.minX, 0.0001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.0001);

  return {
    x: clamp((iris.x - bounds.minX) / width, 0, 1),
    y: clamp((iris.y - bounds.minY) / height, 0, 1)
  };
}

function computeBlinkRatio(landmarks) {
  const leftOpen = distance(landmarks[159], landmarks[145]) / Math.max(distance(landmarks[33], landmarks[133]), 0.0001);
  const rightOpen = distance(landmarks[386], landmarks[374]) / Math.max(distance(landmarks[362], landmarks[263]), 0.0001);
  return (leftOpen + rightOpen) / 2;
}

function updateCursorVisual() {
  if (!cursorElement) return;

  cursorElement.style.transform = `translate(${currentPosition.x}px, ${currentPosition.y}px)`;
  cursorElement.classList.toggle('visible', eyeState.cursorVisible);
}

function resetHoverOutline() {
  if (hoverOutlineElement) {
    hoverOutlineElement.style.outline = '';
    hoverOutlineElement.style.outlineOffset = '';
    hoverOutlineElement = null;
  }
}

function highlightHoverTarget(element) {
  if (hoverOutlineElement === element) return;
  resetHoverOutline();
  hoverOutlineElement = element;
  hoverOutlineElement.style.outline = '2px solid rgba(127, 148, 255, 0.9)';
  hoverOutlineElement.style.outlineOffset = '2px';
}

function resetDwell() {
  eyeState.dwellProgress = 0;
  hoveredTarget = null;
  dwellStartTime = 0;
  resetHoverOutline();
}

function findClickableTargetAtCursor() {
  const element = document.elementFromPoint(currentPosition.x, currentPosition.y);
  if (!element) return null;

  return element.closest(
    'button, a, input, select, textarea, [data-route], [data-action], .nav-item, .quick-action-card, .target-button'
  );
}

function triggerAutoClick(element) {
  if (!element) return;

  if (typeof element.focus === 'function') {
    element.focus({ preventScroll: true });
  }

  if (typeof element.click === 'function') {
    element.click();
  } else {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }
}

function updateDwell(now) {
  if (!eyeState.cursorVisible || eyeState.controlMode !== 'paused') {
    resetDwell();
    return;
  }

  const target = findClickableTargetAtCursor();
  if (!target) {
    resetDwell();
    return;
  }

  if (target !== hoveredTarget) {
    hoveredTarget = target;
    dwellStartTime = now;
    eyeState.dwellProgress = 0;
    highlightHoverTarget(target);
    return;
  }

  eyeState.dwellProgress = now - dwellStartTime;
  if (eyeState.dwellProgress >= eyeState.dwellTime) {
    triggerAutoClick(target);
    resetDwell();
  }
}

function setMode(mode) {
  eyeState.controlMode = mode;
  saveConfig({ controlMode: mode, cursorVisible: eyeState.cursorVisible });
  if (mode === 'active') {
    eyeState.cursorVisible = true;
    baselinePending = true;
  }
  resetDwell();
  updateCursorVisual();
  notifyState();
}

function toggleMode() {
  setMode(eyeState.controlMode === 'active' ? 'paused' : 'active');
}

function applyGazeMovement(timestamp) {
  if (!eyeState.faceDetected) {
    resetDwell();
    return;
  }

  if (eyeState.controlMode === 'active') {
    resetDwell();

    if (!eyeState.cursorVisible) {
      eyeState.cursorVisible = true;
      saveConfig({ cursorVisible: true });
    }

    if (baselinePending || !eyeState.baseline) {
      eyeState.baseline = { x: eyeState.gazeX, y: eyeState.gazeY };
      baselinePending = false;
      updateCursorVisual();
      return;
    }

    const deltaTime = Math.max(0.7, Math.min(2.4, (timestamp - lastFrameStamp) / 16.67));
    const rawX = eyeState.baseline.x - eyeState.gazeX;
    const rawY = eyeState.gazeY - eyeState.baseline.y;

    const normX = Math.abs(rawX) < DEADZONE ? 0 : rawX - Math.sign(rawX) * DEADZONE;
    const normY = Math.abs(rawY) < DEADZONE ? 0 : rawY - Math.sign(rawY) * DEADZONE;

    const speedFactor = 18 + eyeState.sensitivity * 3.8;
    currentPosition.x = clamp(currentPosition.x + normX * speedFactor * deltaTime, 12, window.innerWidth - 12);
    currentPosition.y = clamp(currentPosition.y + normY * speedFactor * deltaTime, 12, window.innerHeight - 12);
    updateCursorVisual();
    return;
  }

  updateDwell(timestamp);
  updateCursorVisual();
}

function updateBlinkState(timestamp, landmarks) {
  const blinkRatio = computeBlinkRatio(landmarks);
  const isClosed = blinkRatio < 0.17;
  eyeState.blinkClosed = isClosed;

  if (isClosed && !blinkStartTime) {
    blinkStartTime = timestamp;
    blinkConsumed = false;
  }

  if (!isClosed) {
    blinkStartTime = 0;
    blinkConsumed = false;
    return;
  }

  if (!blinkConsumed && timestamp - blinkStartTime >= LONG_BLINK_MS && timestamp - lastToggleTime >= TOGGLE_COOLDOWN_MS) {
    blinkConsumed = true;
    lastToggleTime = timestamp;
    toggleMode();
  }
}

function processLandmarks(landmarks, timestamp) {
  const leftIris = normalizeIrisPosition(landmarks, LEFT_EYE_INDICES, LEFT_IRIS_INDICES);
  const rightIris = normalizeIrisPosition(landmarks, RIGHT_EYE_INDICES, RIGHT_IRIS_INDICES);
  const rawGaze = {
    x: (leftIris.x + rightIris.x) / 2,
    y: (leftIris.y + rightIris.y) / 2
  };

  const smoothingBlend = clamp(0.34 - eyeState.smoothing * 0.026, 0.06, 0.22);
  filteredGaze.x += (rawGaze.x - filteredGaze.x) * smoothingBlend;
  filteredGaze.y += (rawGaze.y - filteredGaze.y) * smoothingBlend;

  eyeState.gazeX = filteredGaze.x;
  eyeState.gazeY = filteredGaze.y;
  eyeState.faceDetected = true;
  eyeState.trackingMessage = 'Rosto detectado';

  updateBlinkState(timestamp, landmarks);
  applyGazeMovement(timestamp);
}

function clearTrackingState(message = 'Aguardando rosto') {
  eyeState.faceDetected = false;
  eyeState.trackingMessage = message;
  eyeState.blinkClosed = false;
  baselinePending = true;
  resetDwell();
}

async function ensureFaceLandmarker() {
  if (faceLandmarker) {
    return faceLandmarker;
  }

  eyeState.loading = true;
  notifyState();

  if (!visionModule) {
    visionModule = await import(TASKS_VISION_URL);
  }

  if (!filesetResolver) {
    filesetResolver = await visionModule.FilesetResolver.forVisionTasks(TASKS_WASM_URL);
  }

  try {
    faceLandmarker = await visionModule.FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU'
      },
      outputFaceBlendshapes: false,
      runningMode: 'VIDEO',
      numFaces: 1
    });
  } catch {
    faceLandmarker = await visionModule.FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'CPU'
      },
      outputFaceBlendshapes: false,
      runningMode: 'VIDEO',
      numFaces: 1
    });
  }

  eyeState.loading = false;
  notifyState();
  return faceLandmarker;
}

function detectLoop() {
  if (!videoElement || !faceLandmarker || !eyeState.cameraActive) {
    return;
  }

  const now = performance.now();
  if (videoElement.readyState >= 2 && videoElement.currentTime !== lastVideoTime) {
    lastVideoTime = videoElement.currentTime;
    const result = faceLandmarker.detectForVideo(videoElement, now);

    if (result.faceLandmarks?.length) {
      processLandmarks(result.faceLandmarks[0], now);
    } else {
      clearTrackingState('Rosto não encontrado');
      applyGazeMovement(now);
    }

    notifyState();
  }

  lastFrameStamp = now;
  animationFrameId = requestAnimationFrame(detectLoop);
}

export function initEyeControl({ video, placeholder, cursor }) {
  videoElement = video;
  placeholderElement = placeholder;
  cursorElement = cursor;
  updateCursorVisual();
  window.addEventListener('resize', () => {
    currentPosition.x = clamp(currentPosition.x, 12, window.innerWidth - 12);
    currentPosition.y = clamp(currentPosition.y, 12, window.innerHeight - 12);
    updateCursorVisual();
  });
  notifyState();
}

export function subscribeEyeState(listener) {
  subscribers.push(listener);
  listener({ ...eyeState });
  return () => {
    const index = subscribers.indexOf(listener);
    if (index >= 0) subscribers.splice(index, 1);
  };
}

export function getEyeControlState() {
  return { ...eyeState };
}

export async function requestCamera() {
  if (!videoElement || !placeholderElement) {
    throw new Error('A interface da webcam não foi inicializada.');
  }

  await ensureFaceLandmarker();

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador não suporta acesso à webcam.');
  }

  if (!mediaStream) {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });
  }

  videoElement.srcObject = mediaStream;
  videoElement.classList.add('active');
  placeholderElement.style.display = 'none';
  await videoElement.play();

  eyeState.cameraActive = true;
  eyeState.cameraReady = true;
  eyeState.trackingMessage = 'Webcam ativa';
  notifyState();

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  lastVideoTime = -1;
  animationFrameId = requestAnimationFrame(detectLoop);
}

export function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (videoElement) {
    videoElement.pause();
    videoElement.srcObject = null;
    videoElement.classList.remove('active');
  }

  if (placeholderElement) {
    placeholderElement.style.display = 'grid';
  }

  eyeState.cameraActive = false;
  eyeState.cameraReady = false;
  clearTrackingState('Webcam desligada');
  notifyState();
}

export function toggleControlMode() {
  toggleMode();
}

export function toggleCursorVisibility() {
  eyeState.cursorVisible = !eyeState.cursorVisible;
  saveConfig({ cursorVisible: eyeState.cursorVisible });
  if (!eyeState.cursorVisible) {
    resetDwell();
  }
  updateCursorVisual();
  notifyState();
}

export function updateEyeConfig(partial) {
  const next = saveConfig(partial);
  eyeState.sensitivity = Number(next.sensitivity);
  eyeState.smoothing = Number(next.smoothing);
  notifyState();
}
