export function navigate(path) {
  const normalized = path.startsWith('#') ? path : `#${path}`;
  if (location.hash === normalized) {
    window.dispatchEvent(new Event('hashchange'));
    return;
  }
  location.hash = normalized;
}

export function initRouter(onChange) {
  window.addEventListener('hashchange', () => onChange(resolveRoute(location.hash)));
  onChange(resolveRoute(location.hash));
}

export function resolveRoute(hash) {
  const path = (hash || '#/dashboard').replace(/^#/, '') || '/dashboard';
  const clean = path.startsWith('/') ? path : `/${path}`;

  if (clean === '/dashboard') {
    return { name: 'dashboard', path: clean, params: {} };
  }

  if (clean === '/students') {
    return { name: 'students', path: clean, params: {} };
  }

  if (clean === '/students/new') {
    return { name: 'studentCreate', path: clean, params: {} };
  }

  const studentDetail = clean.match(/^\/students\/([^/]+)$/);
  if (studentDetail) {
    return { name: 'studentDetail', path: clean, params: { id: studentDetail[1] } };
  }

  const studentEdit = clean.match(/^\/students\/([^/]+)\/edit$/);
  if (studentEdit) {
    return { name: 'studentEdit', path: clean, params: { id: studentEdit[1] } };
  }

  if (clean === '/accessibility') {
    return { name: 'accessibility', path: clean, params: {} };
  }

  return { name: 'dashboard', path: '/dashboard', params: {} };
}
