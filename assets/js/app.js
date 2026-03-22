import {
  initEyeControl,
  requestCamera,
  autoRequestCameraOnStart,
  stopCamera,
  startCalibration,
  toggleControlMode,
  toggleCursorVisibility,
  updateEyeConfig,
  subscribeEyeState,
  getEyeControlState
} from './eyeControl.js';

const STORAGE_KEY = 'paa_students_v6';
const SESSION_KEY = 'paa_session_v6';
const TEST_PANEL_KEY = 'paa_test_panel_v6';
const DEFAULT_LOGIN = {
  email: 'admin@portal.local',
  password: '123456',
  name: 'Administrador'
};

const DEFAULT_STUDENTS = [
  {
    id: crypto.randomUUID(),
    name: 'Ana Clara Martins',
    registration: '2026001',
    email: 'ana.martins@faculdade.local',
    course: 'Engenharia de Software',
    period: '6º período',
    status: 'Ativo',
    notes: 'Monitora do laboratório de UX.'
  },
  {
    id: crypto.randomUUID(),
    name: 'Bruno Henrique Costa',
    registration: '2026002',
    email: 'bruno.costa@faculdade.local',
    course: 'Ciência da Computação',
    period: '4º período',
    status: 'Pendente',
    notes: 'Documentação acadêmica em revisão.'
  },
  {
    id: crypto.randomUUID(),
    name: 'Carla Fernanda Souza',
    registration: '2026003',
    email: 'carla.souza@faculdade.local',
    course: 'Sistemas de Informação',
    period: '8º período',
    status: 'Ativo',
    notes: 'Participa do projeto de acessibilidade web.'
  },
  {
    id: crypto.randomUUID(),
    name: 'Diego Alves Rocha',
    registration: '2026004',
    email: 'diego.rocha@faculdade.local',
    course: 'Engenharia de Software',
    period: '2º período',
    status: 'Trancado',
    notes: 'Solicitou retorno no próximo semestre.'
  }
];

const COURSES = ['Engenharia de Software', 'Ciência da Computação', 'Sistemas de Informação', 'Análise e Desenvolvimento'];

const state = {
  route: 'dashboard',
  students: loadStudents(),
  session: loadSession(),
  editingStudentId: null,
  search: ''
};

const pageMeta = {
  dashboard: {
    eyebrow: 'Portal acadêmico',
    title: 'Dashboard',
    description: 'Resumo rápido do sistema e do estado de acessibilidade.'
  },
  students: {
    eyebrow: 'Gestão acadêmica',
    title: 'Alunos',
    description: 'Consulta, busca e ações rápidas sobre os registros.'
  },
  'student-form': {
    eyebrow: 'Cadastro',
    title: 'Formulário de aluno',
    description: 'Cadastro e edição com um fluxo simples.'
  },
  accessibility: {
    eyebrow: 'Ajuste inicial',
    title: 'Rastreamento ocular',
    description: 'A câmera abre no início. Direita/esquerda seguem os olhos. Cima/baixo combinam olhos com inclinação vertical do rosto.'
  }
};

const routeToNav = {
  dashboard: 'dashboard',
  students: 'students',
  'student-form': 'student-form',
  accessibility: 'accessibility'
};

const appShell = document.getElementById('app-shell');
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const logoutButton = document.getElementById('logout-button');
const navButtons = [...document.querySelectorAll('.nav-button')];
const sections = [...document.querySelectorAll('.route-section')];
const pageEyebrow = document.getElementById('page-eyebrow');
const pageTitle = document.getElementById('page-title');
const pageDescription = document.getElementById('page-description');
const sessionName = document.getElementById('session-name');
const sessionEmail = document.getElementById('session-email');
const dashboardMetrics = document.getElementById('dashboard-metrics');
const dashboardSummaryList = document.getElementById('dashboard-summary-list');
const dashboardAccessibilityList = document.getElementById('dashboard-accessibility-list');
const dashboardStudentsBody = document.getElementById('dashboard-students-body');
const dashboardOpenStudents = document.getElementById('dashboard-open-students');
const studentsTableBody = document.getElementById('students-table-body');
const openNewStudentButton = document.getElementById('open-new-student');
const studentSearch = document.getElementById('student-search');
const studentForm = document.getElementById('student-form');
const studentFormTitle = document.getElementById('student-form-title');
const cancelStudentForm = document.getElementById('cancel-student-form');
const cameraPlaceholder = document.getElementById('camera-placeholder');
const retryCameraButton = document.getElementById('start-camera-button');
const stopCameraButton = document.getElementById('stop-camera-button');
const startCalibrationButton = document.getElementById('start-calibration-button');
const toggleModeButton = document.getElementById('toggle-mode-button');
const toggleCursorButton = document.getElementById('toggle-cursor-button');
const eyeSettingsForm = document.getElementById('eye-settings-form');
const sensitivityLabel = document.getElementById('sensitivity-label');
const smoothingLabel = document.getElementById('smoothing-label');
const sensitivityXLabel = document.getElementById('sensitivity-x-label');
const sensitivityYLabel = document.getElementById('sensitivity-y-label');
const smoothingXLabel = document.getElementById('smoothing-x-label');
const smoothingYLabel = document.getElementById('smoothing-y-label');
const cameraStatusPill = document.getElementById('camera-status-pill');
const calibrationStatusPill = document.getElementById('calibration-status-pill');
const modeStatusPill = document.getElementById('mode-status-pill');
const cameraStateLabel = document.getElementById('camera-state-label');
const trackingStateLabel = document.getElementById('tracking-state-label');
const blinkStateLabel = document.getElementById('blink-state-label');
const dwellStateLabel = document.getElementById('dwell-state-label');
const toastStack = document.getElementById('toast-stack');
const testDisclosure = document.getElementById('test-disclosure');
const closeTestPanelButton = document.getElementById('close-test-panel');

boot();

async function boot() {
  await initEyeControl();
  populateCourseSelect();
  syncTestDisclosureFromStorage();
  bindEvents();
  subscribeEyeState(handleEyeStateChange);
  const eyeState = getEyeControlState();
  if (eyeSettingsForm) {
    eyeSettingsForm.elements.sensitivity.value = String(eyeState.sensitivity);
    eyeSettingsForm.elements.smoothing.value = String(eyeState.smoothing);
    eyeSettingsForm.elements.sensitivityX.value = String(eyeState.sensitivityX);
    eyeSettingsForm.elements.sensitivityY.value = String(eyeState.sensitivityY);
    eyeSettingsForm.elements.smoothingX.value = String(eyeState.smoothingX);
    eyeSettingsForm.elements.smoothingY.value = String(eyeState.smoothingY);
  }
  sensitivityLabel.textContent = String(eyeState.sensitivity);
  smoothingLabel.textContent = String(eyeState.smoothing);
  sensitivityXLabel.textContent = String(eyeState.sensitivityX);
  sensitivityYLabel.textContent = String(eyeState.sensitivityY);
  smoothingXLabel.textContent = String(eyeState.smoothingX);
  smoothingYLabel.textContent = String(eyeState.smoothingY);
  render();

  autoRequestCameraOnStart().catch((error) => {
    showToast('Permissão da webcam', getReadableError(error), true);
  });
}

function bindEvents() {
  loginForm.addEventListener('submit', handleLogin);
  logoutButton.addEventListener('click', handleLogout);
  dashboardOpenStudents.addEventListener('click', () => goTo('students'));
  openNewStudentButton.addEventListener('click', openCreateStudent);
  cancelStudentForm.addEventListener('click', () => goTo('students'));

  studentSearch.addEventListener('input', (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderStudents();
  });

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const route = button.dataset.route;
      if (route === 'student-form') {
        openCreateStudent();
        return;
      }
      goTo(route);
    });
  });

  studentForm.addEventListener('submit', handleStudentSubmit);

  retryCameraButton?.addEventListener('click', async () => {
    try {
      await requestCamera();
      showToast('Webcam ativada', 'A câmera foi ligada novamente. Primeiro o sistema mostra um aviso e depois abre a tela de calibração.');
    } catch (error) {
      showToast('Erro ao ativar a webcam', getReadableError(error), true);
    }
  });

  stopCameraButton?.addEventListener('click', () => {
    stopCamera();
    showToast('Webcam desligada', 'O rastreamento foi pausado.');
  });

  startCalibrationButton?.addEventListener('click', async () => {
    try {
      await startCalibration();
      showToast('Aviso de calibração', 'Confirme o aviso para a tela de calibração aparecer e refazer o ajuste desta sessão.');
    } catch (error) {
      showToast('Não foi possível refazer o ajuste', getReadableError(error), true);
    }
  });

  toggleModeButton?.addEventListener('click', () => {
    toggleControlMode();
  });

  toggleCursorButton?.addEventListener('click', () => {
    toggleCursorVisibility();
  });

  eyeSettingsForm?.addEventListener('input', () => {
    const data = new FormData(eyeSettingsForm);
    const sensitivity = Number(data.get('sensitivity'));
    const smoothing = Number(data.get('smoothing'));
    const sensitivityX = Number(data.get('sensitivityX'));
    const sensitivityY = Number(data.get('sensitivityY'));
    const smoothingX = Number(data.get('smoothingX'));
    const smoothingY = Number(data.get('smoothingY'));
    sensitivityLabel.textContent = String(sensitivity);
    smoothingLabel.textContent = String(smoothing);
    sensitivityXLabel.textContent = String(sensitivityX);
    sensitivityYLabel.textContent = String(sensitivityY);
    smoothingXLabel.textContent = String(smoothingX);
    smoothingYLabel.textContent = String(smoothingY);
    updateEyeConfig({ sensitivity, smoothing, sensitivityX, sensitivityY, smoothingX, smoothingY });
  });

  testDisclosure?.addEventListener('toggle', () => {
    localStorage.setItem(TEST_PANEL_KEY, testDisclosure.open ? 'open' : 'closed');
  });

  closeTestPanelButton?.addEventListener('click', () => {
    if (!testDisclosure) return;
    testDisclosure.open = false;
    localStorage.setItem(TEST_PANEL_KEY, 'closed');
  });

  document.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;

    const id = actionButton.dataset.id;
    const action = actionButton.dataset.action;
    if (action === 'edit') {
      openEditStudent(id);
      return;
    }
    if (action === 'delete') {
      deleteStudent(id);
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-toast]');
    if (target) {
      showToast('Ação simulada', target.dataset.toast);
    }
  });
}

function handleEyeStateChange(eyeState) {
  cameraStatusPill.textContent = eyeState.cameraActive ? 'Câmera ligada' : 'Câmera desligada';
  calibrationStatusPill.textContent = eyeState.calibrated ? 'Ajuste concluído' : eyeState.calibrationText;
  modeStatusPill.textContent = eyeState.controlActive ? 'Modo mover' : 'Modo pausado';
  modeStatusPill.classList.toggle('success', !eyeState.controlActive);

  cameraStateLabel.textContent = eyeState.cameraActive ? 'Ligada' : 'Desligada';
  trackingStateLabel.textContent = eyeState.trackingText;
  blinkStateLabel.textContent = eyeState.blinkText;
  dwellStateLabel.textContent = `${(eyeState.dwellMs / 1000).toFixed(1)}s / ${((eyeState.dwellTargetMs || 3000) / 1000).toFixed(1)}s`; 
  cameraPlaceholder.classList.toggle('hidden', eyeState.cameraActive);

  if (retryCameraButton) retryCameraButton.classList.toggle('hidden', eyeState.cameraActive);
  if (stopCameraButton) stopCameraButton.classList.toggle('hidden', !eyeState.cameraActive);
  if (startCalibrationButton) startCalibrationButton.disabled = !(eyeState.cameraActive && eyeState.faceDetected);
  if (toggleModeButton) toggleModeButton.disabled = !eyeState.calibrated;
  if (toggleModeButton) toggleModeButton.textContent = eyeState.controlActive ? 'Pausar cursor' : 'Mover cursor';
  if (toggleCursorButton) toggleCursorButton.textContent = eyeState.cursorVisible ? 'Ocultar cursor' : 'Mostrar cursor';

  renderDashboardAccessibility(eyeState);
}


function syncTestDisclosureFromStorage() {
  if (!testDisclosure) return;
  const state = localStorage.getItem(TEST_PANEL_KEY);
  testDisclosure.open = state === 'open';
}

function loadStudents() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STUDENTS));
    return [...DEFAULT_STUDENTS];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_STUDENTS];
  } catch {
    return [...DEFAULT_STUDENTS];
  }
}

function saveStudents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.students));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function handleLogin(event) {
  event.preventDefault();
  const data = new FormData(loginForm);
  const email = String(data.get('email') || '').trim();
  const password = String(data.get('password') || '').trim();

  if (email !== DEFAULT_LOGIN.email || password !== DEFAULT_LOGIN.password) {
    showToast('Login inválido', 'Use o e-mail e a senha de demonstração exibidos na tela.', true);
    return;
  }

  state.session = { name: DEFAULT_LOGIN.name, email };
  saveSession(state.session);
  state.route = getEyeControlState().calibrated ? 'dashboard' : 'accessibility';
  render();
}

function handleLogout() {
  clearSession();
  state.session = null;
  render();
}

function goTo(route) {
  state.route = route;
  const meta = pageMeta[route];
  pageEyebrow.textContent = meta.eyebrow;
  pageTitle.textContent = meta.title;
  pageDescription.textContent = meta.description;

  sections.forEach((section) => {
    section.classList.toggle('active', section.id === `section-${route}`);
  });

  navButtons.forEach((button) => {
    button.classList.toggle('active', routeToNav[route] === button.dataset.route);
  });

  if (route === 'students') renderStudents();
  if (route === 'student-form') fillStudentForm();
  if (route === 'dashboard') renderDashboard();
}

function render() {
  const authenticated = Boolean(state.session);
  loginOverlay.classList.toggle('hidden', authenticated);
  appShell.classList.toggle('hidden', !authenticated);

  if (!authenticated) return;

  if (!getEyeControlState().calibrated && state.route === 'dashboard') {
    state.route = 'accessibility';
  }

  sessionName.textContent = state.session.name;
  sessionEmail.textContent = state.session.email;
  goTo(state.route);
}

function renderDashboard() {
  const total = state.students.length;
  const active = state.students.filter((student) => student.status === 'Ativo').length;
  const pending = state.students.filter((student) => student.status === 'Pendente').length;

  dashboardMetrics.innerHTML = [
    metricTemplate('Total de alunos', String(total), 'Base local do portal'),
    metricTemplate('Ativos', String(active), 'Registros em situação regular'),
    metricTemplate('Pendentes', String(pending), 'Revisões ainda em aberto')
  ].join('');

  dashboardSummaryList.innerHTML = [
    summaryTemplate('Fluxo principal', 'Login, consulta de alunos, edição e acessibilidade já estão no protótipo.'),
    summaryTemplate('Persistência local', 'Os cadastros ficam salvos no navegador para a demonstração.')
  ].join('');

  renderDashboardAccessibility(getEyeControlState());

  dashboardStudentsBody.innerHTML = state.students
    .slice(0, 4)
    .map(
      (student) => `
        <tr>
          <td>${student.registration}</td>
          <td>${student.name}</td>
          <td>${student.course}</td>
          <td>${statusBadge(student.status)}</td>
        </tr>
      `
    )
    .join('');
}

function renderDashboardAccessibility(eyeState) {
  dashboardAccessibilityList.innerHTML = [
    summaryTemplate('Câmera', eyeState.cameraActive ? 'Ligada e pronta para rastrear.' : 'Permissão ainda não concedida.'),
    summaryTemplate('Ajuste inicial', eyeState.calibrated ? 'Concluído para esta pessoa e este monitor.' : eyeState.calibrationText),
    summaryTemplate('Modo atual', eyeState.controlActive ? 'Movendo o cursor pelo olhar com dwell de 3 segundos ativo.' : 'Cursor pausado para leitura, ainda com dwell disponível sobre alvos.')
  ].join('');
}

function renderStudents() {
  const query = state.search;
  const filtered = state.students.filter((student) => {
    if (!query) return true;
    return [student.name, student.registration, student.course, student.email].join(' ').toLowerCase().includes(query);
  });

  if (!filtered.length) {
    studentsTableBody.innerHTML = `<tr><td colspan="6" class="table-empty">Nenhum aluno encontrado.</td></tr>`;
    return;
  }

  studentsTableBody.innerHTML = filtered
    .map(
      (student) => `
        <tr>
          <td>${student.registration}</td>
          <td>${student.name}</td>
          <td>${student.course}</td>
          <td>${student.period}</td>
          <td>${statusBadge(student.status)}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-secondary" type="button" data-action="edit" data-id="${student.id}">Editar</button>
              <button class="btn btn-ghost" type="button" data-action="delete" data-id="${student.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `
    )
    .join('');
}

function openCreateStudent() {
  state.editingStudentId = null;
  studentForm.reset();
  fillStudentForm();
  goTo('student-form');
}

function openEditStudent(id) {
  state.editingStudentId = id;
  fillStudentForm();
  goTo('student-form');
}

function fillStudentForm() {
  const courseSelect = studentForm.elements.course;
  if (!courseSelect.options.length) populateCourseSelect();

  const student = state.students.find((item) => item.id === state.editingStudentId);
  studentFormTitle.textContent = student ? 'Editar aluno' : 'Novo aluno';
  studentForm.elements.name.value = student?.name || '';
  studentForm.elements.registration.value = student?.registration || '';
  studentForm.elements.email.value = student?.email || '';
  studentForm.elements.course.value = student?.course || COURSES[0];
  studentForm.elements.period.value = student?.period || '';
  studentForm.elements.status.value = student?.status || 'Ativo';
  studentForm.elements.notes.value = student?.notes || '';
}

function populateCourseSelect() {
  const select = studentForm.elements.course;
  select.innerHTML = COURSES.map((course) => `<option value="${course}">${course}</option>`).join('');
}

function handleStudentSubmit(event) {
  event.preventDefault();
  const data = new FormData(studentForm);
  const payload = {
    id: state.editingStudentId || crypto.randomUUID(),
    name: String(data.get('name') || '').trim(),
    registration: String(data.get('registration') || '').trim(),
    email: String(data.get('email') || '').trim(),
    course: String(data.get('course') || '').trim(),
    period: String(data.get('period') || '').trim(),
    status: String(data.get('status') || '').trim(),
    notes: String(data.get('notes') || '').trim()
  };

  if (state.editingStudentId) {
    state.students = state.students.map((student) => (student.id === payload.id ? payload : student));
    showToast('Aluno atualizado', 'Os dados do aluno foram salvos no navegador.');
  } else {
    state.students.unshift(payload);
    showToast('Aluno cadastrado', 'Novo registro adicionado com sucesso.');
  }

  saveStudents();
  state.editingStudentId = null;
  renderDashboard();
  goTo('students');
}

function deleteStudent(id) {
  const student = state.students.find((item) => item.id === id);
  if (!student) return;

  const confirmed = window.confirm(`Deseja remover ${student.name}?`);
  if (!confirmed) return;

  state.students = state.students.filter((item) => item.id !== id);
  saveStudents();
  renderStudents();
  renderDashboard();
  showToast('Aluno removido', 'O registro foi removido do portal local.');
}

function metricTemplate(label, value, helper) {
  return `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${helper}</small>
    </article>
  `;
}

function summaryTemplate(title, text) {
  return `
    <article class="summary-item">
      <strong>${title}</strong>
      <span>${text}</span>
    </article>
  `;
}

function statusBadge(status) {
  const tone =
    status === 'Ativo' ? 'success' :
    status === 'Pendente' ? 'warning' :
    'neutral';

  return `<span class="table-badge ${tone}">${status}</span>`;
}

function showToast(title, description, danger = false) {
  const toast = document.createElement('article');
  toast.className = `toast ${danger ? 'danger' : ''}`;
  toast.innerHTML = `
    <strong>${title}</strong>
    <span>${description}</span>
  `;
  toastStack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

function getReadableError(error) {
  if (!error) return 'Erro desconhecido.';
  const message = String(error.message || error);

  if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
    return 'Você precisa permitir o uso da webcam no navegador.';
  }
  if (message.includes('NotFoundError')) {
    return 'Nenhuma webcam compatível foi encontrada.';
  }
  return message;
}
