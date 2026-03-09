import { initialDatabase } from './mockData.js';

const DB_KEY = 'paa-db';
const SESSION_KEY = 'paa-session';
const CONFIG_KEY = 'paa-config';

const defaultConfig = {
  sensitivity: 6,
  dwellTime: 7000,
  smoothing: 7,
  controlMode: 'paused',
  cursorVisible: false
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function seedDatabase() {
  const existing = localStorage.getItem(DB_KEY);
  if (!existing) {
    localStorage.setItem(DB_KEY, JSON.stringify(initialDatabase));
  }

  const existingConfig = localStorage.getItem(CONFIG_KEY);
  if (!existingConfig) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(defaultConfig));
  }
}

export function getDatabase() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    seedDatabase();
    return clone(initialDatabase);
  }

  try {
    return JSON.parse(raw);
  } catch {
    localStorage.setItem(DB_KEY, JSON.stringify(initialDatabase));
    return clone(initialDatabase);
  }
}

export function saveDatabase(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function getStudents() {
  return getDatabase().students;
}

export function getCourses() {
  return getDatabase().courses;
}

export function getStudentById(id) {
  return getStudents().find((student) => student.id === id) ?? null;
}

export function createStudent(payload) {
  const db = getDatabase();
  const student = {
    id: generateId(),
    lastUpdate: new Date().toISOString().slice(0, 10),
    performance: Number(payload.performance || 0),
    ...payload
  };

  db.students.unshift(student);
  saveDatabase(db);
  return student;
}

export function updateStudent(id, payload) {
  const db = getDatabase();
  const index = db.students.findIndex((student) => student.id === id);

  if (index === -1) {
    return null;
  }

  db.students[index] = {
    ...db.students[index],
    ...payload,
    performance: Number(payload.performance || db.students[index].performance || 0),
    lastUpdate: new Date().toISOString().slice(0, 10)
  };

  saveDatabase(db);
  return db.students[index];
}

export function deleteStudent(id) {
  const db = getDatabase();
  db.students = db.students.filter((student) => student.id !== id);
  saveDatabase(db);
}

export function resetDatabase() {
  localStorage.setItem(DB_KEY, JSON.stringify(initialDatabase));
}

export function login(email, password) {
  const isValid = email === 'admin@portal.local' && password === '123456';

  if (!isValid) {
    return { success: false, message: 'Credenciais inválidas. Use o login fictício exibido na tela.' };
  }

  const session = {
    name: 'Administrador do Portal',
    email,
    loggedAt: new Date().toISOString()
  };

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { success: true, session };
}

export function getSession() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function getConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  if (!raw) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(defaultConfig));
    return { ...defaultConfig };
  }

  try {
    return { ...defaultConfig, ...JSON.parse(raw) };
  } catch {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(defaultConfig));
    return { ...defaultConfig };
  }
}

export function saveConfig(partial) {
  const current = getConfig();
  const next = { ...current, ...partial };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

export function getDashboardMetrics() {
  const students = getStudents();
  const active = students.filter((student) => student.status === 'Ativo').length;
  const analysis = students.filter((student) => student.status === 'Em análise').length;
  const locked = students.filter((student) => student.status === 'Trancado').length;
  const courses = [...new Set(students.map((student) => student.course))].length;
  const averagePerformance = students.length
    ? (students.reduce((sum, student) => sum + Number(student.performance || 0), 0) / students.length).toFixed(1)
    : '0.0';

  return {
    totalStudents: students.length,
    activeStudents: active,
    analysisStudents: analysis,
    lockedStudents: locked,
    totalCourses: courses,
    averagePerformance
  };
}

function generateId() {
  return `stu-${crypto.randomUUID().slice(0, 8)}`;
}
