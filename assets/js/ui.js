function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(date);
}

function getStatusClass(status) {
  if (status === 'Ativo') return 'success';
  if (status === 'Em análise') return 'warning';
  if (status === 'Trancado') return 'danger';
  return 'info';
}

function renderStudentTableRows(students) {
  if (!students.length) {
    return `
      <tr>
        <td colspan="7">
          <div class="empty-state">
            <h2>Nenhum aluno encontrado</h2>
            <p>Ajuste os filtros ou cadastre um novo aluno para continuar.</p>
          </div>
        </td>
      </tr>
    `;
  }

  return students
    .map(
      (student) => `
        <tr>
          <td><strong>${student.registration}</strong></td>
          <td>
            <strong>${student.name}</strong>
            <span class="small">${student.email}</span>
          </td>
          <td>${student.course}</td>
          <td>${student.semester}</td>
          <td><span class="badge ${getStatusClass(student.status)}">${student.status}</span></td>
          <td>${formatDate(student.lastUpdate)}</td>
          <td>
            <div class="btn-icon-group">
              <button class="btn-icon" data-route="/students/${student.id}">Abrir</button>
              <button class="btn-icon" data-route="/students/${student.id}/edit">Editar</button>
              <button class="btn-icon" data-action="delete-student" data-id="${student.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `
    )
    .join('');
}

export function getPageMeta(route) {
  const map = {
    dashboard: {
      eyebrow: 'Sistema acadêmico',
      title: 'Dashboard',
      description: 'Visão geral operacional da instituição, alunos cadastrados e indicadores principais.'
    },
    students: {
      eyebrow: 'Gestão acadêmica',
      title: 'Alunos',
      description: 'Consulte, filtre e acompanhe os registros acadêmicos cadastrados no portal.'
    },
    studentCreate: {
      eyebrow: 'Cadastro acadêmico',
      title: 'Novo aluno',
      description: 'Cadastre um novo aluno no portal e mantenha as informações atualizadas.'
    },
    studentEdit: {
      eyebrow: 'Cadastro acadêmico',
      title: 'Editar aluno',
      description: 'Atualize dados cadastrais, status e indicadores do registro selecionado.'
    },
    studentDetail: {
      eyebrow: 'Ficha acadêmica',
      title: 'Detalhes do aluno',
      description: 'Acompanhe informações, contexto acadêmico e pontos de atenção do registro.'
    },
    accessibility: {
      eyebrow: 'Acessibilidade',
      title: 'Controle ocular e testes',
      description: 'Área preparada para webcam, cursor virtual, alternância por piscada longa e clique por permanência.'
    }
  };

  return map[route.name] ?? map.dashboard;
}

export function renderRouteView({ route, metrics, students, courses, currentStudent, filters, searchQuery, eyeState }) {
  switch (route.name) {
    case 'students':
      return renderStudentsView({ students, courses, filters, searchQuery });
    case 'studentCreate':
      return renderStudentFormView({ courses, student: null, mode: 'create' });
    case 'studentEdit':
      return renderStudentFormView({ courses, student: currentStudent, mode: 'edit' });
    case 'studentDetail':
      return renderStudentDetailView({ student: currentStudent });
    case 'accessibility':
      return renderAccessibilityView({ eyeState });
    case 'dashboard':
    default:
      return renderDashboardView({ metrics, students, searchQuery });
  }
}

function renderDashboardView({ metrics, students, searchQuery }) {
  const filtered = students.slice(0, 5);
  const recent = searchQuery
    ? students.filter((student) => `${student.name} ${student.registration} ${student.course}`.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 5)
    : filtered;

  return `
    <section class="dashboard-grid">
      <article class="kpi-card">
        <p class="eyebrow">Total de alunos</p>
        <strong>${metrics.totalStudents}</strong>
        <span class="trend">Base local pronta para benchmark</span>
      </article>
      <article class="kpi-card">
        <p class="eyebrow">Alunos ativos</p>
        <strong>${metrics.activeStudents}</strong>
        <span class="trend">Maioria acompanhada em tempo real</span>
      </article>
      <article class="kpi-card">
        <p class="eyebrow">Cursos ativos</p>
        <strong>${metrics.totalCourses}</strong>
        <span class="trend">Estrutura de portal institucional</span>
      </article>
      <article class="kpi-card">
        <p class="eyebrow">Média de desempenho</p>
        <strong>${metrics.averagePerformance}</strong>
        <span class="trend">Indicador mockado para demonstração</span>
      </article>
    </section>

    <section class="content-grid-2">
      <article class="table-wrap">
        <div class="card-head">
          <div>
            <p class="eyebrow">Registros recentes</p>
            <h3>Alunos em destaque</h3>
          </div>
          <button class="btn btn-secondary" data-route="/students">Abrir gestão completa</button>
        </div>

        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Matrícula</th>
                <th>Aluno</th>
                <th>Curso</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${recent.length ? recent
                .map(
                  (student) => `
                    <tr>
                      <td><strong>${student.registration}</strong></td>
                      <td>
                        <strong>${student.name}</strong>
                        <span class="small">${student.email}</span>
                      </td>
                      <td>${student.course}</td>
                      <td><span class="badge ${getStatusClass(student.status)}">${student.status}</span></td>
                      <td>
                        <div class="btn-icon-group">
                          <button class="btn-icon" data-route="/students/${student.id}">Abrir</button>
                          <button class="btn-icon" data-route="/students/${student.id}/edit">Editar</button>
                        </div>
                      </td>
                    </tr>
                  `
                )
                .join('') : `
                  <tr>
                    <td colspan="5">
                      <div class="empty-state">
                        <h2>Nenhum resultado</h2>
                        <p>Sua busca global não encontrou alunos nesta visão resumida.</p>
                      </div>
                    </td>
                  </tr>
                `}
            </tbody>
          </table>
        </div>
      </article>

      <div class="activity-list">
        <article class="activity-card">
          <div class="card-head">
            <div>
              <p class="eyebrow">Objetivo do protótipo</p>
              <h3>Valor para a banca</h3>
            </div>
          </div>

          <div class="info-list">
            <div class="info-row">
              <div>
                <strong>Software com cara de produto real</strong>
                <small>Portal acadêmico com fluxo de uso plausível para avaliação.</small>
              </div>
            </div>
            <div class="info-row">
              <div>
                <strong>Base pronta para acessibilidade</strong>
                <small>Webcam, cursor virtual, alternância de modo e clique por permanência.</small>
              </div>
            </div>
            <div class="info-row">
              <div>
                <strong>Persistência local</strong>
                <small>Os dados são salvos no navegador para a demonstração ficar consistente.</small>
              </div>
            </div>
          </div>
        </article>

        <article class="timeline-card">
          <div class="card-head">
            <div>
              <p class="eyebrow">Próximas fases</p>
              <h3>Roteiro técnico</h3>
            </div>
          </div>

          <div class="timeline-list">
            <div class="timeline-item">
              <strong>1. Portal base</strong>
              <small>Layout, login fictício, CRUD e persistência local.</small>
            </div>
            <div class="timeline-item">
              <strong>2. Rastreamento ocular</strong>
              <small>Mapeamento relativo do olhar para o cursor virtual.</small>
            </div>
            <div class="timeline-item">
              <strong>3. Alternância por piscada</strong>
              <small>Troca entre mover e pausar com piscar prolongado.</small>
            </div>
            <div class="timeline-item">
              <strong>4. Benchmark</strong>
              <small>Tarefas, métricas, logs e resultados para o TCC.</small>
            </div>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderStudentsView({ students, courses, filters, searchQuery }) {
  return `
    <section class="filters-bar">
      <div class="card-head">
        <div>
          <p class="eyebrow">Filtros</p>
          <h3>Consulta de alunos</h3>
        </div>
        <div class="actions-row">
          <button class="btn btn-secondary" data-route="/students/new">Cadastrar aluno</button>
          <button class="btn btn-ghost" data-action="reset-filters">Limpar filtros</button>
        </div>
      </div>

      <form id="student-filter-form" class="filter-grid">
        <label>
          <span>Busca</span>
          <input type="search" name="query" value="${searchQuery ?? ''}" placeholder="Nome, matrícula ou curso" />
        </label>

        <label>
          <span>Curso</span>
          <select name="course">
            <option value="">Todos</option>
            ${courses.map((course) => `<option value="${course}" ${filters.course === course ? 'selected' : ''}>${course}</option>`).join('')}
          </select>
        </label>

        <label>
          <span>Status</span>
          <select name="status">
            <option value="">Todos</option>
            ${['Ativo', 'Em análise', 'Trancado'].map((status) => `<option value="${status}" ${filters.status === status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </label>

        <button class="btn btn-primary" type="submit">Aplicar</button>
      </form>
    </section>

    <section class="table-wrap">
      <div class="card-head">
        <div>
          <p class="eyebrow">Resultado</p>
          <h3>Base acadêmica local</h3>
          <small class="table-meta">${students.length} registro(s) encontrado(s)</small>
        </div>
      </div>

      <div class="table-responsive">
        <table>
          <thead>
            <tr>
              <th>Matrícula</th>
              <th>Aluno</th>
              <th>Curso</th>
              <th>Período</th>
              <th>Status</th>
              <th>Atualizado em</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${renderStudentTableRows(students)}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderStudentFormView({ courses, student, mode }) {
  if (mode === 'edit' && !student) {
    return renderMissingRecord();
  }

  const title = mode === 'edit' ? 'Editar aluno' : 'Cadastrar aluno';
  const subtitle = mode === 'edit'
    ? 'Atualize os dados do registro selecionado.'
    : 'Preencha os campos para adicionar um novo registro ao portal.';

  return `
    <section class="form-shell">
      <div class="form-head">
        <div>
          <p class="eyebrow">Formulário</p>
          <h2 class="form-title">${title}</h2>
          <p class="page-description">${subtitle}</p>
        </div>
        <button class="btn btn-secondary" data-route="/students">Voltar para alunos</button>
      </div>

      <form id="student-form" class="student-form" data-mode="${mode}" ${student ? `data-student-id="${student.id}"` : ''}>
        <label>
          <span>Nome completo</span>
          <input name="name" required value="${student?.name ?? ''}" />
        </label>

        <label>
          <span>Matrícula</span>
          <input name="registration" required value="${student?.registration ?? ''}" />
        </label>

        <label>
          <span>E-mail</span>
          <input type="email" name="email" required value="${student?.email ?? ''}" />
        </label>

        <label>
          <span>Telefone</span>
          <input name="phone" value="${student?.phone ?? ''}" />
        </label>

        <label>
          <span>Curso</span>
          <select name="course" required>
            ${courses.map((course) => `<option value="${course}" ${student?.course === course ? 'selected' : ''}>${course}</option>`).join('')}
          </select>
        </label>

        <label>
          <span>Período</span>
          <input name="semester" required value="${student?.semester ?? ''}" placeholder="Ex.: 6º" />
        </label>

        <label>
          <span>Turno</span>
          <select name="shift" required>
            ${['Matutino', 'Noturno', 'Integral'].map((shift) => `<option value="${shift}" ${student?.shift === shift ? 'selected' : ''}>${shift}</option>`).join('')}
          </select>
        </label>

        <label>
          <span>Status</span>
          <select name="status" required>
            ${['Ativo', 'Em análise', 'Trancado'].map((status) => `<option value="${status}" ${student?.status === status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </label>

        <label>
          <span>Cidade</span>
          <input name="city" value="${student?.city ?? ''}" />
        </label>

        <label>
          <span>Desempenho (0 a 10)</span>
          <input type="number" step="0.1" min="0" max="10" name="performance" value="${student?.performance ?? 7.5}" />
        </label>

        <label>
          <span>Frequência</span>
          <input name="attendance" value="${student?.attendance ?? '85%'}" />
        </label>

        <label class="span-2">
          <span>Observações</span>
          <textarea name="notes">${student?.notes ?? ''}</textarea>
        </label>

        <div class="span-2 helper-row">
          <small class="form-hint">Todos os dados são salvos localmente no navegador para demonstração do sistema.</small>
          <div class="actions-row">
            <button class="btn btn-secondary" type="button" data-route="/students">Cancelar</button>
            <button class="btn btn-primary" type="submit">${mode === 'edit' ? 'Salvar alterações' : 'Cadastrar aluno'}</button>
          </div>
        </div>
      </form>
    </section>
  `;
}

function renderStudentDetailView({ student }) {
  if (!student) {
    return renderMissingRecord();
  }

  return `
    <section class="detail-hero">
      <div class="detail-head">
        <div>
          <p class="eyebrow">Ficha acadêmica</p>
          <h2>${student.name}</h2>
          <p class="subtitle">${student.course} · ${student.semester} · ${student.shift}</p>
        </div>
        <div class="actions-row">
          <button class="btn btn-secondary" data-route="/students/${student.id}/edit">Editar</button>
          <button class="btn btn-danger" data-action="delete-student" data-id="${student.id}">Excluir</button>
        </div>
      </div>

      <div class="stats-row">
        <div class="data-point">
          <span class="status-label">Matrícula</span>
          <strong>${student.registration}</strong>
          <small>Identificador do aluno</small>
        </div>
        <div class="data-point">
          <span class="status-label">Status</span>
          <strong>${student.status}</strong>
          <small>Estado atual do vínculo</small>
        </div>
        <div class="data-point">
          <span class="status-label">Desempenho</span>
          <strong>${student.performance}</strong>
          <small>Indicador acadêmico mockado</small>
        </div>
        <div class="data-point">
          <span class="status-label">Frequência</span>
          <strong>${student.attendance}</strong>
          <small>Valor usado na demonstração</small>
        </div>
      </div>
    </section>

    <section class="detail-grid">
      <article class="surface">
        <div class="card-head">
          <div>
            <p class="eyebrow">Dados gerais</p>
            <h3>Informações do cadastro</h3>
          </div>
        </div>

        <div class="info-list">
          <div class="info-row"><span>E-mail</span><strong>${student.email}</strong></div>
          <div class="info-row"><span>Telefone</span><strong>${student.phone || 'Não informado'}</strong></div>
          <div class="info-row"><span>Cidade</span><strong>${student.city || 'Não informada'}</strong></div>
          <div class="info-row"><span>Última atualização</span><strong>${formatDate(student.lastUpdate)}</strong></div>
        </div>
      </article>

      <article class="surface">
        <div class="card-head">
          <div>
            <p class="eyebrow">Observações</p>
            <h3>Contexto acadêmico</h3>
          </div>
        </div>

        <p class="page-description">${student.notes || 'Sem observações cadastradas.'}</p>

        <div class="quick-actions">
          <button class="quick-action-card" data-route="/students/${student.id}/edit">
            <strong>Atualizar cadastro</strong>
            <span class="small">Corrigir dados ou trocar status.</span>
          </button>
          <button class="quick-action-card" data-route="/accessibility">
            <strong>Ir para acessibilidade</strong>
            <span class="small">Testar navegação assistiva no portal.</span>
          </button>
        </div>
      </article>
    </section>
  `;
}

function renderAccessibilityView({ eyeState }) {
  const cameraStatus = eyeState.cameraActive ? 'Ligada' : 'Desligada';
  const trackingStatus = eyeState.faceDetected ? 'Rosto detectado' : 'Aguardando rosto';
  const blinkStatus = eyeState.blinkClosed ? 'Piscada detectada' : 'Olhos abertos';
  const dwellSeconds = Math.min(7, Math.max(0, eyeState.dwellProgress / 1000)).toFixed(1);

  return `
    <section class="content-grid-2">
      <article class="surface">
        <div class="card-head">
          <div>
            <p class="eyebrow">Fluxo de uso</p>
            <h3>Como o portal será usado</h3>
          </div>
        </div>

        <div class="timeline-list">
          <div class="timeline-item">
            <strong>1. Ativar webcam</strong>
            <small>O navegador pede permissão e libera a captura em tempo real.</small>
          </div>
          <div class="timeline-item">
            <strong>2. Piscada longa alterna o modo</strong>
            <small>Quando ativo, o olhar move o cursor virtual como um joystick. Quando pausado, o cursor congela.</small>
          </div>
          <div class="timeline-item">
            <strong>3. Clique por permanência</strong>
            <small>Ao pausar sobre algo clicável por 7 segundos, o sistema dispara o clique automaticamente.</small>
          </div>
        </div>

        <div class="target-grid">
          <button class="target-button" data-route="/dashboard">Dashboard</button>
          <button class="target-button" data-route="/students">Alunos</button>
          <button class="target-button" data-route="/students/new">Novo aluno</button>
          <button class="target-button" data-route="/accessibility">Acessibilidade</button>
          <button class="target-button" data-action="toggle-control">Alternar modo</button>
          <button class="target-button" data-action="toggle-cursor">Mostrar cursor</button>
        </div>
      </article>

      <article class="surface">
        <div class="card-head">
          <div>
            <p class="eyebrow">Telemetria local</p>
            <h3>Sinais do rastreamento</h3>
          </div>
        </div>

        <div class="info-list">
          <div class="info-row"><span>Webcam</span><strong id="telemetry-camera">${cameraStatus}</strong></div>
          <div class="info-row"><span>Rastreamento</span><strong id="telemetry-tracking">${trackingStatus}</strong></div>
          <div class="info-row"><span>Modo atual</span><strong id="telemetry-mode">${eyeState.controlMode === 'active' ? 'Ativo' : 'Pausado'}</strong></div>
          <div class="info-row"><span>Piscada</span><strong id="telemetry-blink">${blinkStatus}</strong></div>
          <div class="info-row"><span>Gaze X</span><strong id="telemetry-gaze-x">${eyeState.gazeX.toFixed(3)}</strong></div>
          <div class="info-row"><span>Gaze Y</span><strong id="telemetry-gaze-y">${eyeState.gazeY.toFixed(3)}</strong></div>
          <div class="info-row"><span>Dwell atual</span><strong id="telemetry-dwell">${dwellSeconds}s / 7.0s</strong></div>
        </div>
      </article>
    </section>
  `;
}

function renderMissingRecord() {
  return `
    <section class="empty-state">
      <h2>Registro não encontrado</h2>
      <p>O aluno solicitado não existe mais ou o identificador informado é inválido.</p>
      <button class="btn btn-primary" data-route="/students">Voltar para alunos</button>
    </section>
  `;
}
