import {
  initEyeControl,
  requestCamera,
  stopCamera,
  startCalibration,
  toggleControlMode,
  toggleCursorVisibility,
  updateEyeConfig,
  subscribeEyeState,
  getEyeControlState
} from './eyeControl.js';

const STORAGE_KEY = 'paa_students_v2';
const SESSION_KEY = 'paa_session_v2';
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
    eyebrow: 'Acessibilidade',
    title: 'Controle ocular',
    description: 'Ative a câmera, calibre e valide o movimento antes de usar o portal.'
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
const startCameraButton = document.getElementById('start-camera-button');
const stopCameraButton = document.getElementById('stop-camera-button');
const startCalibrationButton = document.getElementById('start-calibration-button');
const toggleModeButton = document.getElementById('toggle-mode-button');
const toggleCursorButton = document.getElementById('toggle-cursor-button');
const eyeSettingsForm = document.getElementById('eye-settings-form');
const sensitivityLabel = document.getElementById('sensitivity-label');
const smoothingLabel = document.getElementById('smoothing-label');
const cameraStatusPill = document.getElementById('camera-status-pill');
const calibrationStatusPill = document.getElementById('calibration-status-pill');
const modeStatusPill = document.getElementById('mode-status-pill');
const cameraStateLabel = document.getElementById('camera-state-label');
const trackingStateLabel = document.getElementById('tracking-state-label');
const blinkStateLabel = document.getElementById('blink-state-label');
const dwellStateLabel = document.getElementById('dwell-state-label');
const toastStack = document.getElementById('toast-stack');

boot();

async function boot() {
  await initEyeControl();
  populateCourseSelect();
  bindEvents();
  subscribeEyeState(handleEyeStateChange);
  render();
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

  startCameraButton.addEventListener('click', async () => {
    try {
      await requestCamera();
      showToast('Webcam ativada', 'Agora faça a calibração guiada antes de usar o cursor.');
    } catch (error) {
      showToast('Erro ao ativar a webcam', getReadableError(error), true);
    }
  });

  stopCameraButton.addEventListener('click', () => {
    stopCamera();
    showToast('Webcam desligada', 'O controle ocular foi pausado.');
  });

  startCalibrationButton.addEventListener('click', async () => {
    try {
      await startCalibration();
      showToast('Calibração concluída', 'Agora o eixo vertical e horizontal foram ajustados para a sua câmera.');
    } catch (error) {
      showToast('Não foi possível calibrar', getReadableError(error), true);
    }
  });

  toggleModeButton.addEventListener('click', () => {
    toggleControlMode();
  });

  toggleCursorButton.addEventListener('click', () => {
    toggleCursorVisibility();
  });

  eyeSettingsForm.addEventListener('input', () => {
    const data = new FormData(eyeSettingsForm);
    const sensitivity = Number(data.get('sensitivity'));
    const smoothing = Number(data.get('smoothing'));
    sensitivityLabel.textContent = String(sensitivity);
    smoothingLabel.textContent = String(smoothing);
    updateEyeConfig({ sensitivity, smoothing });
  });

  document.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) {
      return;
    }

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
  calibrationStatusPill.textContent = eyeState.calibrated ? 'Calibração concluída' : 'Calibração pendente';
  modeStatusPill.textContent = eyeState.controlActive ? 'Modo mover' : 'Modo pausado';
  modeStatusPill.classList.toggle('success', !eyeState.controlActive);
  cameraStateLabel.textContent = eyeState.cameraActive ? 'Ligada' : 'Desligada';
  trackingStateLabel.textContent = eyeState.trackingText;
  blinkStateLabel.textContent = eyeState.blinkText;
  dwellStateLabel.textContent = `${(eyeState.dwellMs / 1000).toFixed(1)}s / 7.0s`;
  cameraPlaceholder.classList.toggle('hidden', eyeState.cameraActive);

  startCalibrationButton.disabled = !eyeState.cameraActive;
  toggleModeButton.disabled = !eyeState.calibrated;

  renderDashboardAccessibility(eyeState);
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

  if (route === 'students') {
    renderStudents();
  }

  if (route === 'student-form') {
    fillStudentForm();
  }

  if (route === 'dashboard') {
    renderDashboard();
  }
}

function render() {
  const authenticated = Boolean(state.session);
  loginOverlay.classList.toggle('hidden', authenticated);
  appShell.classList.toggle('hidden', !authenticated);

  if (!authenticated) {
    return;
  }

  sessionName.textContent = state.session.name;
  sessionEmail.textContent = state.session.email;
  goTo(state.route);
}

function renderDashboard() {
  const total = state.students.length;
  const active = state.students.filter((student) => student.status === 'Ativo').length;
  const pending = state.students.filter((student) => student.status === 'Pendente').length;
  const courses = new Set(state.students.map((student) => student.course)).size;

  dashboardMetrics.innerHTML = [
    metricTemplate('Total de alunos', String(total), 'Base local do portal'),
    metricTemplate('Ativos', String(active), 'Registros em situação regular'),
    metricTemplate('Pendentes', String(pending), 'Revisões ainda em aberto'),
    metricTemplate('Cursos', String(courses), 'Cursos representados na amostra')
  ].join('');

  dashboardSummaryList.innerHTML = [
    summaryTemplate('Tela enxuta', 'Os dados principais aparecem primeiro e o resto só quando necessário.'),
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
    summaryTemplate('Câmera', eyeState.cameraActive ? 'Ligada e pronta para rastrear.' : 'Ainda desligada.'),
    summaryTemplate('Calibração', eyeState.calibrated ? 'Concluída para esta pessoa e este monitor.' : 'Ainda precisa ser feita.'),
    summaryTemplate('Modo atual', eyeState.controlActive ? 'Movendo o cursor pelo olhar.' : 'Cursor pausado para leitura.'),
    summaryTemplate('Rastreamento', eyeState.trackingText)
  ].join('');
}

function renderStudents() {
  const query = state.search;
  const filtered = state.students.filter((student) => {
    if (!query) {
      return true;
    }

    return [student.name, student.registration, student.course, student.email]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  if (!filtered.length) {
    studentsTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">Nenhum aluno encontrado.</td>
      </tr>
    `;
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
  if (!courseSelect.options.length) {
    populateCourseSelect();
  }

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
  if (!student) {
    return;
  }

  const confirmed = window.confirm(`Deseja remover ${student.name}?`);
  if (!confirmed) {
    return;
  }

  state.students = state.students.filter((item) => item.id !== id);
  saveStudents();
  renderStudents();
  renderDashboard();
  showToast('Aluno removido', `${student.name} foi removido da base local.`);
}

function metricTemplate(label, value, hint) {
  return `
    <article class="metric-card">
      <small>${label}</small>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `;
}

function summaryTemplate(title, text) {
  return `
    <div class="summary-item">
      <strong>${title}</strong>
      <span>${text}</span>
    </div>
  `;
}

function statusBadge(status) {
  const className = status === 'Ativo' ? 'is-active' : status === 'Pendente' ? 'is-pending' : 'is-trancado';
  return `<span class="table-badge ${className}">${status}</span>`;
}

function getReadableError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Tente novamente.';
}

function showToast(title, text, isError = false) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<strong>${title}</strong><span>${text}</span>`;
  if (isError) {
    toast.style.borderColor = 'rgba(255, 106, 122, 0.3)';
  }
  toastStack.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3600);
}
