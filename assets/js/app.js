import { navigate, initRouter } from './router.js';
import {
  seedDatabase,
  getStudents,
  getCourses,
  getStudentById,
  createStudent,
  updateStudent,
  deleteStudent,
  getDashboardMetrics,
  login,
  getSession,
  logout,
  getConfig,
  resetDatabase
} from './storage.js';
import { getPageMeta, renderRouteView } from './ui.js';
import {
  initEyeControl,
  requestCamera,
  stopCamera,
  toggleControlMode,
  toggleCursorVisibility,
  updateEyeConfig,
  getEyeControlState,
  subscribeEyeState
} from './eyeControl.js';

seedDatabase();

const state = {
  route: { name: 'dashboard', path: '/dashboard', params: {} },
  searchQuery: '',
  filters: {
    course: '',
    status: ''
  },
  session: getSession()
};

const authOverlay = document.getElementById('auth-overlay');
const appShell = document.getElementById('app-shell');
const routeView = document.getElementById('route-view');
const pageTitle = document.getElementById('page-title');
const pageEyebrow = document.getElementById('page-eyebrow');
const pageDescription = document.getElementById('page-description');
const globalSearch = document.getElementById('global-search');
const sessionUserName = document.getElementById('session-user-name');
const sessionUserEmail = document.getElementById('session-user-email');
const loginForm = document.getElementById('login-form');
const logoutButton = document.getElementById('logout-button');
const cameraToggle = document.getElementById('camera-toggle');
const cameraStop = document.getElementById('camera-stop');
const controlToggle = document.getElementById('toggle-control-mode');
const cursorToggle = document.getElementById('toggle-cursor-visibility');
const accessibilityConfigForm = document.getElementById('accessibility-config-form');
const webcamPreview = document.getElementById('webcam-preview');
const webcamPlaceholder = document.getElementById('webcam-placeholder');
const virtualCursor = document.getElementById('virtual-cursor');

initEyeControl({
  video: webcamPreview,
  placeholder: webcamPlaceholder,
  cursor: virtualCursor
});

const savedConfig = getConfig();
accessibilityConfigForm.elements.namedItem('sensitivity').value = String(savedConfig.sensitivity);
accessibilityConfigForm.elements.namedItem('smoothing').value = String(savedConfig.smoothing);

function showToast(title, message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3400);
}

function applyAuthState() {
  const hasSession = Boolean(state.session);
  authOverlay.classList.toggle('hidden', hasSession);
  appShell.classList.toggle('locked', !hasSession);
  appShell.setAttribute('aria-hidden', String(!hasSession));

  sessionUserName.textContent = hasSession ? state.session.name : 'Administrador';
  sessionUserEmail.textContent = hasSession ? state.session.email : 'admin@portal.local';
}

function getFilteredStudents() {
  const query = state.searchQuery.trim().toLowerCase();

  return getStudents().filter((student) => {
    const matchesQuery = !query || `${student.name} ${student.registration} ${student.course} ${student.email}`.toLowerCase().includes(query);
    const matchesCourse = !state.filters.course || student.course === state.filters.course;
    const matchesStatus = !state.filters.status || student.status === state.filters.status;
    return matchesQuery && matchesCourse && matchesStatus;
  });
}

function updateNavigationState() {
  document.querySelectorAll('[data-route]').forEach((button) => {
    if (!button.classList.contains('nav-item')) return;
    const targetRoute = button.getAttribute('data-route');
    const isActive = state.route.path === targetRoute || (targetRoute === '/students' && state.route.path.startsWith('/students/') && state.route.path !== '/students/new');
    button.classList.toggle('active', isActive);
  });
}

function refreshTelemetry(stateSnapshot) {
  const cameraPill = document.getElementById('camera-pill');
  const controlPill = document.getElementById('control-pill');
  const controlModeLabel = document.getElementById('control-mode-label');
  const cursorLabel = document.getElementById('cursor-label');
  const trackingLabel = document.getElementById('tracking-label');
  const blinkLabel = document.getElementById('blink-label');
  const dwellLabel = document.getElementById('dwell-label');
  const sensitivityValue = document.getElementById('sensitivity-value');
  const smoothingValue = document.getElementById('smoothing-value');

  cameraPill.textContent = stateSnapshot.cameraActive ? 'ligada' : 'desligada';
  controlPill.textContent = stateSnapshot.controlMode === 'active' ? 'ativo' : 'pausado';
  controlModeLabel.textContent = stateSnapshot.controlMode === 'active' ? 'Ativo' : 'Pausado';
  cursorLabel.textContent = stateSnapshot.cursorVisible ? 'Visível' : 'Oculto';
  trackingLabel.textContent = stateSnapshot.trackingMessage;
  blinkLabel.textContent = stateSnapshot.blinkClosed ? 'Piscada detectada' : 'Olhos abertos';
  dwellLabel.textContent = `${Math.min(7, stateSnapshot.dwellProgress / 1000).toFixed(1)}s / 7.0s`;
  sensitivityValue.textContent = String(stateSnapshot.sensitivity);
  smoothingValue.textContent = String(stateSnapshot.smoothing);

  const telemetryCamera = document.getElementById('telemetry-camera');
  const telemetryTracking = document.getElementById('telemetry-tracking');
  const telemetryMode = document.getElementById('telemetry-mode');
  const telemetryBlink = document.getElementById('telemetry-blink');
  const telemetryGazeX = document.getElementById('telemetry-gaze-x');
  const telemetryGazeY = document.getElementById('telemetry-gaze-y');
  const telemetryDwell = document.getElementById('telemetry-dwell');

  if (telemetryCamera) telemetryCamera.textContent = stateSnapshot.cameraActive ? 'Ligada' : 'Desligada';
  if (telemetryTracking) telemetryTracking.textContent = stateSnapshot.faceDetected ? 'Rosto detectado' : 'Aguardando rosto';
  if (telemetryMode) telemetryMode.textContent = stateSnapshot.controlMode === 'active' ? 'Ativo' : 'Pausado';
  if (telemetryBlink) telemetryBlink.textContent = stateSnapshot.blinkClosed ? 'Piscada detectada' : 'Olhos abertos';
  if (telemetryGazeX) telemetryGazeX.textContent = stateSnapshot.gazeX.toFixed(3);
  if (telemetryGazeY) telemetryGazeY.textContent = stateSnapshot.gazeY.toFixed(3);
  if (telemetryDwell) telemetryDwell.textContent = `${Math.min(7, stateSnapshot.dwellProgress / 1000).toFixed(1)}s / 7.0s`;
}

function render() {
  const meta = getPageMeta(state.route);
  const courses = getCourses();
  const allStudents = getStudents();
  const filteredStudents = getFilteredStudents();
  const currentStudent = state.route.params.id ? getStudentById(state.route.params.id) : null;
  const metrics = getDashboardMetrics();
  const eyeState = getEyeControlState();

  pageEyebrow.textContent = meta.eyebrow;
  pageTitle.textContent = meta.title;
  pageDescription.textContent = meta.description;
  globalSearch.value = state.searchQuery;

  routeView.innerHTML = renderRouteView({
    route: state.route,
    metrics,
    students: filteredStudents,
    courses,
    currentStudent,
    filters: state.filters,
    searchQuery: state.searchQuery,
    eyeState
  });

  updateNavigationState();
  refreshTelemetry(eyeState);
}

subscribeEyeState((eyeState) => {
  refreshTelemetry(eyeState);
});

initRouter((route) => {
  state.route = route;
  render();
});

applyAuthState();
render();

if (!location.hash) {
  navigate('/dashboard');
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const result = login(String(formData.get('email') || ''), String(formData.get('password') || ''));

  if (!result.success) {
    showToast('Falha no login', result.message, 'error');
    return;
  }

  state.session = result.session;
  applyAuthState();
  navigate('/dashboard');
  showToast('Acesso liberado', 'Login realizado com sucesso.');
  loginForm.reset();
});

logoutButton.addEventListener('click', () => {
  logout();
  state.session = null;
  applyAuthState();
  showToast('Sessão encerrada', 'Você saiu do portal.');
});

globalSearch.addEventListener('input', (event) => {
  state.searchQuery = event.target.value;
  render();
});

cameraToggle.addEventListener('click', async () => {
  try {
    await requestCamera();
    showToast('Webcam ativada', 'O rastreamento facial foi iniciado.');
  } catch (error) {
    showToast('Erro na webcam', error.message || 'Não foi possível ativar a webcam.', 'error');
  }
});

cameraStop.addEventListener('click', () => {
  stopCamera();
  showToast('Webcam desligada', 'A captura foi encerrada.');
});

controlToggle.addEventListener('click', () => {
  toggleControlMode();
  showToast('Modo alternado', 'O estado do controle ocular foi alterado.');
});

cursorToggle.addEventListener('click', () => {
  toggleCursorVisibility();
  showToast('Cursor virtual', 'A visibilidade do cursor foi atualizada.');
});

accessibilityConfigForm.addEventListener('input', (event) => {
  const formData = new FormData(accessibilityConfigForm);
  updateEyeConfig({
    sensitivity: Number(formData.get('sensitivity')),
    smoothing: Number(formData.get('smoothing'))
  });
});

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-route], [data-action]');
  if (!target) return;

  const route = target.getAttribute('data-route');
  const action = target.getAttribute('data-action');

  if (route) {
    navigate(route);
    return;
  }

  if (action === 'delete-student') {
    const id = target.getAttribute('data-id');
    const student = id ? getStudentById(id) : null;
    if (!student) return;

    const confirmed = window.confirm(`Deseja excluir o aluno ${student.name}?`);
    if (!confirmed) return;

    deleteStudent(id);
    showToast('Aluno removido', 'O registro foi excluído do armazenamento local.');

    if (state.route.name === 'studentDetail' || state.route.name === 'studentEdit') {
      navigate('/students');
    } else {
      render();
    }
    return;
  }

  if (action === 'reset-filters') {
    state.filters = { course: '', status: '' };
    state.searchQuery = '';
    render();
    return;
  }

  if (action === 'toggle-control') {
    toggleControlMode();
    return;
  }

  if (action === 'toggle-cursor') {
    toggleCursorVisibility();
    return;
  }

  if (action === 'reset-database') {
    const confirmed = window.confirm('Deseja restaurar a base mockada original?');
    if (!confirmed) return;
    resetDatabase();
    render();
    showToast('Base restaurada', 'Os dados locais voltaram ao estado inicial.');
  }
});

document.addEventListener('submit', (event) => {
  const form = event.target;

  if (form.id === 'student-filter-form') {
    event.preventDefault();
    const formData = new FormData(form);
    state.searchQuery = String(formData.get('query') || '');
    state.filters = {
      course: String(formData.get('course') || ''),
      status: String(formData.get('status') || '')
    };
    render();
    return;
  }

  if (form.id === 'student-form') {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
      name: String(formData.get('name') || ''),
      registration: String(formData.get('registration') || ''),
      email: String(formData.get('email') || ''),
      phone: String(formData.get('phone') || ''),
      course: String(formData.get('course') || ''),
      semester: String(formData.get('semester') || ''),
      shift: String(formData.get('shift') || ''),
      status: String(formData.get('status') || ''),
      city: String(formData.get('city') || ''),
      performance: Number(formData.get('performance') || 0),
      attendance: String(formData.get('attendance') || ''),
      notes: String(formData.get('notes') || '')
    };

    const mode = form.dataset.mode;
    if (mode === 'edit') {
      const id = form.dataset.studentId;
      const updated = updateStudent(id, payload);
      if (!updated) {
        showToast('Erro', 'Não foi possível atualizar o aluno.', 'error');
        return;
      }
      showToast('Aluno atualizado', 'As alterações foram salvas com sucesso.');
      navigate(`/students/${updated.id}`);
      return;
    }

    const created = createStudent(payload);
    showToast('Aluno cadastrado', 'O novo registro foi salvo no navegador.');
    navigate(`/students/${created.id}`);
  }
});
