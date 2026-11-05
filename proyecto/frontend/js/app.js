const API_ORIGIN = window.ISO.origin;
const API_BASE = `${API_ORIGIN}/api`;

const state = {
  token: window.ISO.getToken(),
  user: window.ISO.getUser(),
  areas: [],
  selectedEvaluacionId: null,
  selectedEvaluacionRevisionId: null,
  answersMap: {},
  evaluatorCommentsMap: {},
};

const refs = {
  apiStatus: document.getElementById("apiStatus"),
  currentUser: document.getElementById("currentUser"),
  toast: document.getElementById("toast"),
  areasContainer: document.getElementById("areasContainer"),
  loginForm: document.querySelector("#loginTab"),
  adminCreateUserForm: document.querySelector("#adminCreateUserForm"),
  empresaForm: document.querySelector("#empresaForm"),
  evaluacionForm: document.querySelector("#evaluacionForm"),
  refreshAreas: document.querySelector("#refreshAreas"),
  refreshUsers: document.querySelector("#refreshUsers"),
  refreshEmpresas: document.querySelector("#refreshEmpresas"),
  refreshEvaluaciones: document.querySelector("#refreshEvaluaciones"),
  logoutBtn: document.querySelector("#logoutBtn"),
  adminPanel: document.querySelector("#adminPanel"),
  empresarioPanel: document.querySelector("#empresarioPanel"),
  evaluacionPanel: document.querySelector("#evaluacionPanel"),
  usersContainer: document.querySelector("#usersContainer"),
  empresasContainer: document.querySelector("#empresasContainer"),
  evaluacionesContainer: document.querySelector("#evaluacionesContainer"),
  respuestasPanel: document.querySelector("#respuestasPanel"),
  respuestasContainer: document.querySelector("#respuestasContainer"),
  evaluacionSeleccionadaText: document.querySelector("#evaluacionSeleccionadaText"),
  guardarRespuestasBtn: document.querySelector("#guardarRespuestasBtn"),
  soporteForm: document.querySelector("#soporteForm"),
  soporteAreaId: document.querySelector("#soporteAreaId"),
  soporteFile: document.querySelector("#soporteFile"),
  soportesContainer: document.querySelector("#soportesContainer"),
  soportesEvaluadorContainer: document.querySelector("#soportesEvaluadorContainer"),
  mensajesIA: document.querySelector("#mensajesIA"),
  evaluadorPanel: document.querySelector("#evaluadorPanel"),
  evaluadorSeleccionText: document.querySelector("#evaluadorSeleccionText"),
  evaluadorPreguntasContainer: document.querySelector("#evaluadorPreguntasContainer"),
  guardarComentariosEvaluadorBtn: document.querySelector("#guardarComentariosEvaluadorBtn"),
  roleHint: document.querySelector("#roleHint"),
};

let toastTimeout;
function showToast(message, type = "ok") {
  if (!refs.toast) return;
  refs.toast.textContent = message;
  refs.toast.className = `toast show ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { refs.toast.className = "toast"; }, 5500);
}

function showIaMessage(message) {
  if (!refs.mensajesIA) return;
  refs.mensajesIA.textContent = message;
  refs.mensajesIA.className = message ? "muted ia-message" : "muted";
}

function clearIaMessage() {
  if (!refs.mensajesIA) return;
  refs.mensajesIA.textContent = "";
}

function buildIaGuidance(payload) {
  if (!payload) return "";
  const parts = [];
  if (payload.sugerenciaIA) parts.push(payload.sugerenciaIA);
  if (Array.isArray(payload.opcionesIA) && payload.opcionesIA.length) {
    parts.push(`Opciones: ${payload.opcionesIA.join(" | ")}`);
  }
  return parts.join(" ").trim();
}

function updateHeader() {
  if (!refs.currentUser) return;
  refs.currentUser.textContent = state.user
    ? `${state.user.nombre} (${state.user.rol})`
    : "Sin sesion";
}

function setRolePanels() {
  const rol = state.user?.rol;
  const isAdmin = rol === "ADMIN";
  const isEmpresario = rol === "EMPRESARIO";
  const isEvaluador = rol === "EVALUADOR"; // La revisión técnica corresponde al equipo consultor, no a ADMIN
  const logged = Boolean(state.user);

  refs.adminPanel?.classList.toggle("hidden", !isAdmin);
  refs.empresarioPanel?.classList.toggle("hidden", !isEmpresario);
  refs.evaluacionPanel?.classList.toggle("hidden", !isEmpresario);
  refs.empresaForm?.closest(".card")?.classList.add("hidden"); // Empresas creadas tras contratación por ADMIN (G1)
  refs.evaluacionForm?.closest(".card")?.classList.add("hidden"); // Diagnosticos nuevos solo dentro del proyecto contratado G1
  refs.respuestasPanel?.classList.toggle("hidden", !isEmpresario || !state.selectedEvaluacionId);
  refs.evaluadorPanel?.classList.toggle("hidden", !isEvaluador || !state.selectedEvaluacionRevisionId);
  if (refs.roleHint) {
    refs.roleHint.textContent = logged
      ? `Sesion activa como ${rol}.`
      : "Inicia sesion para ver modulos.";
  }
}

function redirectToLoginPage() {
  window.location.replace("/pages/login.html");
}

async function api(path, options = {}) {
  return window.ISO.api(path, options);
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\*\*/g, "").trim()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function checkHealth() {
  try {
    const res = await fetch(`${API_ORIGIN}/health`);
    if (!res.ok) throw new Error();
    if (refs.apiStatus) refs.apiStatus.textContent = "Online";
  } catch (_e) {
    if (refs.apiStatus) refs.apiStatus.textContent = "Offline";
  }
}

async function loadAreas() {
  if (refs.areasContainer) {
    refs.areasContainer.innerHTML = "<p class='muted'>Cargando areas...</p>";
  }
  try {
    const areas = await api("/areas");
    state.areas = areas;
    if (!refs.areasContainer) {
      return;
    }

    refs.areasContainer.innerHTML = "";
    areas.forEach((area) => {
      const card = document.createElement("article");
      card.className = "area-card";
      card.innerHTML = `
        <h3>${cleanText(area.orden)}. ${cleanText(area.nombre)}</h3>
        <p>${area.preguntas.length} preguntas</p>
      `;
      refs.areasContainer.appendChild(card);
    });
  } catch (err) {
    if (refs.areasContainer) {
      refs.areasContainer.innerHTML = "<p class='muted'>No se pudo cargar la informacion.</p>";
    }
    showToast(err.message, "error");
  }
}

function renderQuestionsEditor() {
  if (!refs.respuestasContainer) return;

  if (!state.selectedEvaluacionId || !state.areas.length) {
    refs.respuestasContainer.innerHTML = "<p class='muted'>Selecciona una evaluacion para responder.</p>";
    return;
  }

  const totalPreguntas = state.areas.reduce((acc, area) => acc + (area.preguntas?.length || 0), 0);
  if (totalPreguntas === 0) {
    refs.respuestasContainer.innerHTML =
      "<p class='muted'>No hay preguntas configuradas en el sistema. Ejecuta el seed para cargar el cuestionario.</p>";
    return;
  }

  refs.respuestasContainer.innerHTML = "";
  if (refs.soporteAreaId) {
    refs.soporteAreaId.innerHTML = '<option value="">General</option>';
  }

  state.areas.forEach((area) => {
    if (refs.soporteAreaId) {
      refs.soporteAreaId.insertAdjacentHTML(
        "beforeend",
        `<option value="${cleanText(area.id)}">${cleanText(area.orden)}. ${cleanText(area.nombre)}</option>`
      );
    }

    const areaNode = document.createElement("section");
    areaNode.className = "question-area";
    areaNode.innerHTML = `<h3>${cleanText(area.orden)}. ${cleanText(area.nombre)}</h3>`;

    area.preguntas.forEach((pregunta) => {
      const current = state.answersMap[pregunta.id] || { valor: "", comentario: "" };
      const qNode = document.createElement("article");
      qNode.className = "question-item";
      qNode.innerHTML = `
        <p>${cleanText(pregunta.orden)}. ${cleanText(pregunta.texto)}</p>
        ${pregunta.descripcion ? `<p class="question-example">Ejemplo: ${cleanText(pregunta.descripcion)}</p>` : ""}
        <div class="question-controls">
          <label>Nivel declarado
          <select data-question-id="${cleanText(pregunta.id)}" data-field="valor">
            <option value="">Nivel</option>
            <option value="0" ${String(current.valor) === "0" ? "selected" : ""}>0</option>
            <option value="1" ${String(current.valor) === "1" ? "selected" : ""}>1</option>
            <option value="2" ${String(current.valor) === "2" ? "selected" : ""}>2</option>
            <option value="3" ${String(current.valor) === "3" ? "selected" : ""}>3</option>
            <option value="4" ${String(current.valor) === "4" ? "selected" : ""}>4</option>
            <option value="5" ${String(current.valor) === "5" ? "selected" : ""}>5</option>
          </select></label>
          <label>Comentario o evidencia explicativa
          <textarea data-question-id="${cleanText(pregunta.id)}" data-field="comentario" placeholder="Comentario opcional">${
            cleanText(current.comentario || "")
          }</textarea></label>
        </div>
        <p class="muted">${current.actualizadaPor ? `Última modificación registrada: ${cleanText(current.actualizadaPor)}` :
          'Autor de respuestas anteriores a Q-59: no verificable retrospectivamente'}</p>
        ${current.cambios?.length ? `<details><summary>Historial de cambios (${current.cambios.length})</summary><ol>${current.cambios.map(c=>
          `<li>${cleanText(c.autor?.nombre || `Usuario #${cleanText(c.autorId)}`)} · ${cleanText(new Date(c.creadoEn).toLocaleString())} · Nivel: ${cleanText(c.valorAnterior ?? 'sin respuesta')} → ${cleanText(c.valorNuevo)}</li>`).join('')}</ol></details>` : ''}
      `;
      areaNode.appendChild(qNode);
    });

    refs.respuestasContainer.appendChild(areaNode);
  });
}

async function loadSoportes() {
  if (!state.selectedEvaluacionId || !refs.soportesContainer) return;
  const evaluationId = state.selectedEvaluacionId;
  refs.soportesContainer.innerHTML = "<p class='muted'>Cargando soportes...</p>";
  try {
    const soportes = await api(`/soportes/${evaluationId}`);
    if (evaluationId !== state.selectedEvaluacionId) return;
    refs.soportesContainer.innerHTML = "";
    if (!soportes.length) {
      refs.soportesContainer.innerHTML = "<p class='muted'>Aun no hay soportes subidos.</p>";
      return;
    }

    soportes.forEach((s) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <div class="list-title">
          <strong>${cleanText(s.nombreOriginal)}</strong>
          <span class="muted">${Math.round((s.tamanoBytes || 0) / 1024)} KB</span>
        </div>
        <p class="muted">${s.area?.nombre ? `Área: ${cleanText(s.area.nombre)}` : 'Área: General'}</p>
        <p class="muted">${s.fechaVencimiento ? `Vence: ${new Date(s.fechaVencimiento).toLocaleDateString()}` : 'Sin fecha de vencimiento'}</p>
        <p class="muted">${s.estadoIA ? `IA: ${cleanText(s.estadoIA)} - ${cleanText(s.observacionIA || '')}` : ''}</p>
        <div class="list-actions">
          <button data-action="descargar-soporte" data-id="${cleanText(s.id)}">Descargar PDF</button>
          <span class="muted">Documento conservado</span>
        </div>
      `;
      refs.soportesContainer.appendChild(row);
    });
  } catch (err) {
    if (evaluationId !== state.selectedEvaluacionId) return;
    refs.soportesContainer.innerHTML = "<p class='muted'>No se pudo cargar soportes.</p>";
    showToast(err.message, "error");
  }
}

async function loadSoportesForReview() {
  if (!state.selectedEvaluacionRevisionId || !refs.soportesEvaluadorContainer) return;
  const evaluationId = state.selectedEvaluacionRevisionId;
  refs.soportesEvaluadorContainer.innerHTML = "<p class='muted'>Cargando soportes...</p>";
  try {
    const soportes = await api(`/soportes/${evaluationId}`);
    if (evaluationId !== state.selectedEvaluacionRevisionId) return;
    refs.soportesEvaluadorContainer.innerHTML = "";

    if (!soportes.length) {
      refs.soportesEvaluadorContainer.innerHTML = "<p class='muted'>No hay soportes cargados.</p>";
      return;
    }

    soportes.forEach((s) => {
      const row = document.createElement("div");
      row.className = "list-item";
      row.innerHTML = `
        <div class="list-title">
          <strong>${cleanText(s.nombreOriginal)}</strong>
          <span class="muted">${cleanText(s.subidoPor?.nombre || "Usuario")} - ${cleanText(s.area?.nombre || "General")}</span>
        </div>
        <div class="list-actions">
          <button data-action="descargar-soporte" data-id="${cleanText(s.id)}">Descargar PDF</button>
        </div>
      `;
      refs.soportesEvaluadorContainer.appendChild(row);
    });
  } catch (err) {
    if (evaluationId !== state.selectedEvaluacionRevisionId) return;
    refs.soportesEvaluadorContainer.innerHTML = "<p class='muted'>No se pudo cargar soportes.</p>";
    showToast(err.message, "error");
  }
}

function renderEvaluatorReview() {
  if (!refs.evaluadorPreguntasContainer) return;

  if (!state.selectedEvaluacionRevisionId || !state.areas.length) {
    refs.evaluadorPreguntasContainer.innerHTML = "<p class='muted'>Sin evaluacion en revision.</p>";
    return;
  }
  refs.evaluadorPreguntasContainer.innerHTML = "";

  state.areas.forEach((area) => {
    const areaNode = document.createElement("section");
    areaNode.className = "question-area";
    areaNode.innerHTML = `<h3>${cleanText(area.orden)}. ${cleanText(area.nombre)}</h3>`;

    area.preguntas.forEach((pregunta) => {
      const payload = state.evaluatorCommentsMap[pregunta.id] || {};
      const qNode = document.createElement("article");
      qNode.className = "question-item";
      qNode.innerHTML = `
        <p>${cleanText(pregunta.orden)}. ${cleanText(pregunta.texto)}</p>
        <p class="question-example">Respuesta empresario: ${cleanText(payload.valor ?? "-")} | Comentario empresario: ${
          cleanText(payload.comentario) || "-"
        }</p>
        <label>Comentario de revisión
        <textarea data-eval-question-id="${cleanText(pregunta.id)}" placeholder="Comentario del evaluador">${
          cleanText(payload.comentarioEvaluador || "")
        }</textarea></label>
      `;
      areaNode.appendChild(qNode);
    });
    refs.evaluadorPreguntasContainer.appendChild(areaNode);
  });
}

function collectAnswersFromDom() {
  if (!refs.respuestasContainer) return [];

  const selects = refs.respuestasContainer.querySelectorAll('select[data-field="valor"]');
  return Array.from(selects)
    .map((selectEl) => {
      const questionId = Number(selectEl.dataset.questionId);
      const valorRaw = selectEl.value;
      if (!questionId || valorRaw === "") return null;

      const comentarioEl = refs.respuestasContainer.querySelector(
        `textarea[data-field="comentario"][data-question-id="${questionId}"]`
      );

      return {
        preguntaId: questionId,
        valor: Number(valorRaw),
        comentario: comentarioEl?.value?.trim() || "",
      };
    })
    .filter(Boolean);
}

let answerSelectionVersion = 0;
let reviewSelectionVersion = 0;
async function selectEvaluationForAnswers(evaluacionId) {
  if (!refs.evaluacionSeleccionadaText || !refs.respuestasPanel || !refs.respuestasContainer) {
    showToast("Esta vista no tiene panel de respuestas habilitado.", "error");
    return;
  }

  const requestVersion = ++answerSelectionVersion;
  state.selectedEvaluacionId = evaluacionId;
  state.answersMap = {};
  refs.respuestasContainer.textContent = 'Cargando respuestas del diagnóstico seleccionado…';
  refs.respuestasContainer.setAttribute('aria-busy', 'true');
  if (refs.guardarRespuestasBtn) refs.guardarRespuestasBtn.disabled = true;
  if (refs.evaluacionSeleccionadaText) {
    refs.evaluacionSeleccionadaText.textContent = `Evaluacion seleccionada: #${evaluacionId}`;
  }
  refs.respuestasPanel?.classList.remove("hidden");
  showIaMessage("");

  try {
    if (!state.areas.length) await loadAreas();
    if (requestVersion !== answerSelectionVersion) return;
    const detail = await api(`/evaluaciones/${evaluacionId}`);
    if (requestVersion !== answerSelectionVersion) return;
    if (!Array.isArray(detail.respuestas)) throw new Error('El diagnóstico no devolvió respuestas válidas.');
    detail.respuestas.forEach((r) => {
    state.answersMap[r.preguntaId] = { valor: r.valor, comentario: r.comentario || "",
      actualizadaPor: r.actualizadaPor?.nombre || null,
      cambios: r.cambios || [] };
  });

    renderQuestionsEditor();
    if (refs.guardarRespuestasBtn) refs.guardarRespuestasBtn.disabled = false;
    void loadSoportes();
  } catch (error) {
    if (requestVersion === answerSelectionVersion) {
      refs.respuestasContainer.textContent = 'No se pudieron cargar las respuestas: ' + error.message;
      showToast(error.message, 'error');
    }
  } finally {
    if (requestVersion === answerSelectionVersion) refs.respuestasContainer.removeAttribute('aria-busy');
  }
}

async function selectEvaluationForReview(evaluacionId) {
  if (!refs.evaluadorSeleccionText || !refs.evaluadorPanel || !refs.evaluadorPreguntasContainer) {
    showToast("Esta vista no tiene panel de revision habilitado.", "error");
    return;
  }

  const requestVersion = ++reviewSelectionVersion;
  state.selectedEvaluacionRevisionId = evaluacionId;
  state.evaluatorCommentsMap = {};
  refs.evaluadorPreguntasContainer.textContent = 'Cargando revisión del diagnóstico seleccionado…';
  refs.evaluadorPreguntasContainer.setAttribute('aria-busy', 'true');
  if (refs.guardarComentariosEvaluadorBtn) refs.guardarComentariosEvaluadorBtn.disabled = true;
  if (refs.evaluadorSeleccionText) {
    refs.evaluadorSeleccionText.textContent = `Evaluacion en revision: #${evaluacionId}`;
  }
  refs.evaluadorPanel?.classList.remove("hidden");
  showIaMessage("");

  try {
    if (!state.areas.length) await loadAreas();
    if (requestVersion !== reviewSelectionVersion) return;
    const detail = await api(`/evaluaciones/${evaluacionId}`);
    if (requestVersion !== reviewSelectionVersion) return;
    if (!Array.isArray(detail.respuestas)) throw new Error('El diagnóstico no devolvió respuestas válidas.');
    detail.respuestas.forEach((r) => {
    state.evaluatorCommentsMap[r.preguntaId] = {
      valor: r.valor,
      comentario: r.comentario,
      comentarioEvaluador: r.comentarioEvaluador || "",
    };
  });
    renderEvaluatorReview();
    if (refs.guardarComentariosEvaluadorBtn) refs.guardarComentariosEvaluadorBtn.disabled = false;
    void loadSoportesForReview();
  } catch (error) {
    if (requestVersion === reviewSelectionVersion) {
      refs.evaluadorPreguntasContainer.textContent = 'No se pudo cargar la revisión: ' + error.message;
      showToast(error.message, 'error');
    }
  } finally {
    if (requestVersion === reviewSelectionVersion) refs.evaluadorPreguntasContainer.removeAttribute('aria-busy');
  }
}

async function descargarSoporte(id) {
  const response = await fetch(`${API_BASE}/soportes/archivo/${id}`, {
    headers: { Authorization: `Bearer ${state.token}` },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('No se pudo descargar el documento.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const content = response.headers.get('content-disposition') || '';
  const match = content.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : `evidencia_${id}.pdf`;
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadInformePdf(evaluacionId) {
  const res = await fetch(`${API_BASE}/informes/evaluacion/${evaluacionId}/pdf`, {
    headers: { Authorization: `Bearer ${state.token}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || "No se pudo generar el informe PDF");
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const disposition = res.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  const fileName = match?.[1] || `informe_evaluacion_${evaluacionId}.pdf`;

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

let revisionReactivacion = null;
const dialogReactivacion = document.getElementById('reactivacionDialog');

function textoRevision(texto) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = texto;
  return p;
}
async function abrirRevisionReactivacion(id) {
  // Toda la revisión llega de backend, no de la tabla HTML ni de suposiciones del frontend.
  revisionReactivacion = null;
  const revision = await api(`/usuarios/${id}/revision-reactivacion`);
  const lista = document.getElementById('reactivacionRelaciones');
  lista.replaceChildren();
  document.getElementById('reactivacionIdentidad').textContent =
    `${revision.usuario.nombre} · ID ${revision.usuario.id} · ${revision.usuario.rol}`;
  const empresas = revision.relaciones.empresas || [];
  const participaciones = revision.relaciones.participaciones || [];
  lista.append(textoRevision(`Representaciones actuales: ${empresas.length}; participaciones activas: ${participaciones.length}.`));
  for (const empresa of empresas) {
    lista.append(textoRevision(`Representante actual de empresa #${empresa.id}: ${empresa.nombre}.`));
    for (const proyecto of empresa.proyectos || []) {
      lista.append(textoRevision(`Proyecto #${proyecto.id}: ${proyecto.nombre} (${proyecto.estado}).`));
    }
  }
  for (const participacion of participaciones) {
    const proyecto = participacion.proyecto;
    lista.append(textoRevision(`${participacion.principal ? 'Principal' : 'Consultor'} del proyecto #${proyecto.id}: ${proyecto.nombre} (${proyecto.estado}).`));
  }
  if (!empresas.length && !participaciones.length)
    lista.append(textoRevision('No existen relaciones vigentes. No se restaurarán relaciones históricas.'));
  revisionReactivacion = { id, huellaRevision: revision.huellaRevision };
  document.getElementById('reactivacionForm').reset();
  dialogReactivacion.showModal();
}

if (dialogReactivacion) {
  document.getElementById('cancelarReactivacion').addEventListener('click', () => dialogReactivacion.close());
  dialogReactivacion.addEventListener('close', () => { revisionReactivacion = null; });
  document.getElementById('reactivacionForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!revisionReactivacion) return;
    const submit=e.currentTarget.querySelector('button[type="submit"]');
    if(submit?.disabled)return;
    if(submit)submit.disabled=true;
    try {
      await api(`/usuarios/${revisionReactivacion.id}/reactivacion`, {
        method: 'POST', body: JSON.stringify({
          huellaRevision: revisionReactivacion.huellaRevision,
          relacionesConfirmadas: document.getElementById('reactivacionConfirmacion').checked,
          motivoResolucion: document.getElementById('reactivacionMotivo').value,
        }),
      });
      dialogReactivacion.close();
      showToast('Cuenta reactivada tras revisión registrada.');
      await loadUsers();
    } catch (error) {
      showToast(error.message, 'error');
      // Si hay cambio de permisos, la confirmación caduca y se exige recargar los datos.
      if (/cambiaron|cambió|vuelva a revisar/i.test(error.message)) dialogReactivacion.close();
    } finally {if(submit)submit.disabled=false;}
  });
}

// Los filtros son presentación: nunca sustituyen autorización de la API.
let usersLoaded = [], companiesLoaded = [];
function normalized(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim(); }
function renderUsers() {
  if (!refs.usersContainer) return;
  const query = normalized(document.getElementById('filterUsers')?.value);
  const filter = document.getElementById('filterUserStatus')?.value || 'TODOS';
  const rows = usersLoaded.filter(u => {
    const status = filter === 'TODOS' || (filter === 'URGENTES' && u.bloqueoUrgente) ||
      (filter === 'ACTIVOS' && u.activo) || (filter === 'INACTIVOS' && !u.activo);
    return status && normalized(`${u.nombre} ${u.email}`).includes(query);
  });
  refs.usersContainer.replaceChildren();
  document.getElementById('usersSummary').textContent = `${rows.length} de ${usersLoaded.length} cuentas visibles.`;
  if (!rows.length) {
    const empty=document.createElement('p');empty.className='empty-list';
    empty.textContent=usersLoaded.length?'Ninguna cuenta coincide con los filtros.':'No hay cuentas disponibles.';
    refs.usersContainer.append(empty);return;
  }
  for(const u of rows) {
    const box=document.createElement('article');box.className='list-item';
    const title=document.createElement('div');title.className='list-title';
    const name=document.createElement('strong');name.textContent=u.nombre;
    const role=document.createElement('span');role.className='status-pill';role.textContent={ADMIN:'Administración',EMPRESARIO:'Empresa cliente',EVALUADOR:'Consultor'}[u.rol]||u.rol;
    title.append(name,role);
    const mail=document.createElement('p');mail.className='muted';mail.textContent=u.email;
    const status=document.createElement('p');status.className='muted';
    status.textContent=u.bloqueoUrgente?'Bloqueo urgente · requiere revisión expresa':u.activo?'Acceso activo':'Cuenta inactiva';
    const actions=document.createElement('div');actions.className='list-actions';
    function add(label,action,variant='') {const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.action=action;b.dataset.id=String(u.id);if(variant)b.className=variant;actions.append(b);}
    if(u.bloqueoUrgente) add('Revisar y reactivar','review');
    else add(u.activo?'Desactivar':'Activar','toggle',u.activo?'secondary':'');
    if(u.activo&&u.rol!=='ADMIN')add('Bloqueo urgente','urgent','danger-action');
    add('Cambiar rol','role','secondary');
    add('Eliminar','delete','secondary');
    box.append(title,mail,status,actions);refs.usersContainer.append(box);
  }
}
async function loadUsers() {
  if (state.user?.rol !== 'ADMIN' || !refs.usersContainer) return;
  refs.usersContainer.setAttribute('aria-busy','true');
  document.getElementById('usersSummary').textContent='Consultando cuentas…';
  try {
    const users=await api('/usuarios');
    if(!Array.isArray(users))throw Error('La API devolvió un listado de cuentas inválido.');
    usersLoaded=users;renderUsers();
  } catch(err) {
    // No mostrar datos de una consulta anterior como si estuvieran actualizados.
    usersLoaded=[];refs.usersContainer.replaceChildren();
    document.getElementById('usersSummary').textContent='No se pudo consultar el listado.';
    const error=document.createElement('p');error.className='inline-alert error';error.textContent=err.message;
    refs.usersContainer.append(error);
  } finally { refs.usersContainer.setAttribute('aria-busy','false'); }
}
function renderCompanies() {
  if (!refs.empresasContainer) return;
  const query=normalized(document.getElementById('filterCompanies')?.value);
  const status=document.getElementById('filterCompanyStatus')?.value||'TODOS';
  const rows=companiesLoaded.filter(e=>(status==='TODOS'||e.origenDatos===status)&&normalized(`${e.nombre} ${e.nit}`).includes(query));
  refs.empresasContainer.replaceChildren();
  if(document.getElementById('companiesSummary'))document.getElementById('companiesSummary').textContent=`${rows.length} de ${companiesLoaded.length} empresas visibles.`;
  if(!rows.length) {const empty=document.createElement('p');empty.className='empty-list';empty.textContent=companiesLoaded.length?'Ninguna empresa coincide con los filtros.':'No hay empresas visibles.';refs.empresasContainer.append(empty);return;}
  for(const empresa of rows) {
    const box=document.createElement('article');box.className='list-item';
    const top=document.createElement('div');top.className='list-title';
    const title=document.createElement('strong');title.textContent=empresa.nombre;
    const stateLabel=document.createElement('span');stateLabel.className='status-pill';stateLabel.textContent=({FUENTE:'Fuente consultada',ADMIN_PROVISIONAL:'Provisional ADMIN',ADMIN_CONCILIADO:'Conciliada por ADMIN',LEGADO:'Legado sin procedencia'})[empresa.origenDatos]||'Sin procedencia';top.append(title,stateLabel);
    const data=document.createElement('p');data.className='muted';data.textContent=`NIT: ${empresa.nit||'No informado'} · Sector: ${empresa.sector||'No informado'} · Tamaño: ${empresa.tamano||'No informado'} · Representante: ${usersLoaded.find(u=>u.id===empresa.usuarioId)?.nombre||'Cuenta #'+empresa.usuarioId}${empresa.bloqueoNuevosProyectos?' · Nuevos proyectos restringidos':''}`;
    const note=document.createElement('p');note.className='muted';note.textContent=empresa.revisionPendiente?'Información registral pendiente de conciliación.':'Sin conciliación registral pendiente.';
    const actions=document.createElement('div');actions.className='list-actions';
    function add(label,action,variant='secondary'){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.action=action;b.dataset.id=String(empresa.id);b.className=variant;actions.append(b);}
    if(state.user?.rol==='ADMIN') {
      if(empresa.revisionPendiente && empresa.bloqueoNuevosProyectos && empresa.datosFuente) add('Conciliar diferencias','conciliar');
      add('Sustituir representante','representative');
    }
    box.append(top,data,note,actions);refs.empresasContainer.append(box);
  }
}
async function loadEmpresas() {
  if (!state.user || !refs.empresasContainer) return;
  refs.empresasContainer.setAttribute('aria-busy','true');
  document.getElementById('companiesSummary')?.replaceChildren('Consultando empresas…');
  try {
    const empresas=await api('/empresas');
    if(!Array.isArray(empresas))throw Error('La API devolvió un listado de empresas inválido.');
    companiesLoaded=empresas;renderCompanies();
  } catch(err) {
    companiesLoaded=[];refs.empresasContainer.replaceChildren();
    if(document.getElementById('companiesSummary'))document.getElementById('companiesSummary').textContent='No se pudo consultar el listado.';
    const error=document.createElement('p');error.className='inline-alert error';error.textContent=err.message;
    refs.empresasContainer.append(error);
  } finally {refs.empresasContainer.setAttribute('aria-busy','false');}
}
for (const id of ['filterUsers','filterUserStatus'])document.getElementById(id)?.addEventListener(id==='filterUsers'?'input':'change',renderUsers);
for (const id of ['filterCompanies','filterCompanyStatus'])document.getElementById(id)?.addEventListener(id==='filterCompanies'?'input':'change',renderCompanies);

const actionDialog=document.getElementById('accountActionDialog');
let accountAction=null;
function openAccountAction(kind,id) {
  if(!actionDialog)return;
  const u=usersLoaded.find(x=>x.id===id);if(!u)throw Error('La cuenta ya no aparece en el listado. Actualiza antes de continuar.');
  accountAction={kind,id};
  const isUrgent=kind==='urgent';
  document.getElementById('accountActionForm').reset();
  document.getElementById('accountActionRoleField').hidden=isUrgent;
  document.getElementById('accountActionReasonField').hidden=!isUrgent;
  document.getElementById('accountActionRole').required=!isUrgent;
  document.getElementById('accountActionReason').required=isUrgent;
  document.getElementById('accountActionRole').value=u.rol;
  document.getElementById('accountActionTitle').textContent=isUrgent?'Bloqueo urgente justificado':'Cambiar rol de acceso';
  document.getElementById('accountActionDescription').textContent=isUrgent
    ?`Cuenta: ${u.nombre} (${u.email}). El bloqueo invalida sus sesiones activas. Debes registrar el motivo específico.`
    :`Cuenta: ${u.nombre} (${u.email}). El backend impedirá cambios incompatibles con asignaciones vigentes.`;
  document.getElementById('accountActionSubmit').textContent=isUrgent?'Bloquear acceso':'Guardar rol';
  document.getElementById('accountActionError').classList.add('hidden');
  actionDialog.showModal();
}
if(actionDialog) {
  document.getElementById('accountActionCancel').addEventListener('click',()=>actionDialog.close());
  actionDialog.addEventListener('close',()=>{accountAction=null;});
  document.getElementById('accountActionForm').addEventListener('submit',async event=>{
    event.preventDefault();if(!accountAction)return;
    const {kind,id}=accountAction;
    const button=document.getElementById('accountActionSubmit');button.disabled=true;button.textContent='Guardando…';
    try {
      if(kind==='urgent') {
        const motivo=document.getElementById('accountActionReason').value.trim();
        if(motivo.length<10)throw Error('Justifica el bloqueo con al menos 10 caracteres.');
        await api(`/usuarios/${id}/bloqueo-urgente`,{method:'POST',body:JSON.stringify({motivo})});
      } else {
        await api(`/usuarios/${id}`,{method:'PUT',body:JSON.stringify({rol:document.getElementById('accountActionRole').value})});
      }
      actionDialog.close();showToast(kind==='urgent'?'Cuenta bloqueada. Sesiones anteriores invalidadas.':'Rol actualizado.');
      await loadUsers();
    }catch(err) {
      const msg=document.getElementById('accountActionError');msg.textContent=err.message;msg.classList.remove('hidden');
    }finally {button.disabled=false;button.textContent=kind==='urgent'?'Bloquear acceso':'Guardar rol';}
  });
}

async function loadEvaluaciones() {
  if (!state.user) return;
  refs.evaluacionesContainer.innerHTML = "<p class='muted'>Cargando evaluaciones...</p>";
  try {
    const evals = await api("/evaluaciones");
    refs.evaluacionesContainer.innerHTML = "";
    if (!evals.length) refs.evaluacionesContainer.textContent = 'Todavía no existen diagnósticos disponibles para esta cuenta. Se crean desde un proyecto contratado.';
    evals.forEach((ev) => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <div class="list-title">
          <strong>Evaluacion #${cleanText(ev.id)}</strong>
          <span class="muted">${cleanText(ev.estado)}</span>
        </div>
        <p class="muted">Empresa: ${cleanText(ev.empresa?.nombre || "N/A")} | Promedio autodeclarado: ${cleanText(ev.puntajePromedio ?? "-")}</p>
        <p class="muted">Diagnóstico orientativo · Validación de criterios pendiente por especialista SGSI.</p>
        <p class="muted">${state.user.rol === 'EMPRESARIO' && ev.estado === 'BORRADOR' ?
          'Puedes continuar este borrador aunque lo iniciara el representante anterior; la autoría de cada cambio nuevo se conserva.' :
          'La identidad del representante que inició este diagnóstico se conserva como dato histórico.'}</p>
        <div class="list-actions">
          <button data-action="resumen" data-id="${cleanText(ev.id)}">Ver resumen</button>
          ${state.user.rol === "EMPRESARIO" && ev.estado === 'BORRADOR' ? `<button data-action="responder" data-id="${cleanText(ev.id)}">Responder</button>` : ""}
          ${state.user.rol === "EMPRESARIO" && ev.estado === 'BORRADOR' ? `<button data-action="enviar" data-id="${cleanText(ev.id)}">Enviar</button>` : ""}
          ${state.user.rol === "EMPRESARIO" ? `<button data-action="informe" data-id="${cleanText(ev.id)}">Descargar informe</button>` : ""}
        </div>
      `;
      refs.evaluacionesContainer.appendChild(div);
    });
    const requested = Number(new URLSearchParams(location.search).get('diagnostico'));
    if (Number.isSafeInteger(requested) && requested > 0 && state.user.rol==='EMPRESARIO' &&
        evals.some(e=>e.id===requested && e.estado==='BORRADOR') && !state.selectedEvaluacionId) {
      await selectEvaluationForAnswers(requested);
    }
  } catch (err) {
    refs.evaluacionesContainer.innerHTML = "<p class='muted'>No se pudo cargar evaluaciones.</p>";
    showToast(err.message, "error");
  }
}

if (refs.loginForm) {
  const reveal=document.getElementById('revealPassword');
  reveal?.addEventListener('change',()=>{
    const password=document.getElementById('password');
    if(password)password.type=reveal.checked?'text':'password';
  });
  const notice=document.getElementById('loginNotice');
  if(notice&&new URLSearchParams(window.location.search).get('sesion')==='expirada') {
    notice.textContent='La sesión dejó de estar vigente. Inicia sesión nuevamente.';
    notice.classList.remove('hidden');
  }
  // El error permanece junto al acceso hasta que el usuario edite los datos.
  // El aviso de expiración también se limpia al modificar un campo.
  refs.loginForm.addEventListener('input', () => {
    if (notice) { notice.textContent = ''; notice.classList.add('hidden'); }
  });
  refs.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = e.currentTarget.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    const form = new FormData(e.currentTarget);
    if (notice) { notice.textContent = ''; notice.classList.add('hidden'); }
    refs.loginForm.setAttribute('aria-busy', 'true');
    if(submit) { submit.disabled = true; submit.textContent = 'Verificando acceso…'; }

    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      state.token = data.token;
      state.user = data.usuario;
      window.ISO.setSession(data);

      updateHeader();
      setRolePanels();
      showToast("Sesión iniciada");
      
      window.location.replace('./dashboard.html');
    } catch (err) {
      if (notice) {
        notice.textContent = (err.status === 400 || err.status === 401 || err.status === 403)
          ? 'No fue posible iniciar sesión con esas credenciales. Comprueba los datos o solicita ayuda por el canal acordado.'
          : (err.status >= 500 || !err.status)
            ? 'No se pudo verificar el acceso. Revisa tu conexión o intenta de nuevo más tarde.'
            : 'No se pudo iniciar sesión.';
        notice.classList.remove('hidden');
      } else showToast(err.message, 'error');
    } finally {
      refs.loginForm.removeAttribute('aria-busy');
      if(submit) { submit.disabled = false; submit.textContent = 'Iniciar sesión →'; }
    }
  });
}


if (refs.adminCreateUserForm) {
  refs.adminCreateUserForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.user?.rol !== "ADMIN") {
      showToast("Solo admin puede crear usuarios", "error");
      return;
    }
    const form = new FormData(e.currentTarget);
    const submit=e.currentTarget.querySelector('button[type="submit"]');
    if(submit?.disabled)return;
    if(submit)submit.disabled=true;
    try {
      await api("/auth/registro", {
        method: "POST",
        body: JSON.stringify({
          nombre: form.get("nombre"),
          email: form.get("email"),
          password: form.get("password"),
          rol: form.get("rol"),
        }),
      });
      showToast("Usuario creado por admin.");
      e.currentTarget.reset();
      await loadUsers();
    } catch (err) {
      showToast(err.message, "error");
    } finally {if(submit)submit.disabled=false;}
  });
}


if (refs.empresaForm) {
  refs.empresaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);

    try {
      await api("/empresas", {
        method: "POST",
        body: JSON.stringify({
          nombre: form.get("nombre"),
          nit: form.get("nit"),
          sector: form.get("sector"),
          tamano: form.get("tamano"),
        }),
      });
      showToast("Empresa creada");
      e.currentTarget.reset();
      await loadEmpresas();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}


if (refs.evaluacionForm) {
  refs.evaluacionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await api("/evaluaciones", {
        method: "POST",
        body: JSON.stringify({ empresaId: Number(form.get("empresaId")) }),
      });
      showToast("Evaluacion creada");
      e.currentTarget.reset();
      loadEvaluaciones();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}


if (refs.refreshAreas) refs.refreshAreas.addEventListener("click", loadAreas);
if (refs.refreshUsers) refs.refreshUsers.addEventListener("click", loadUsers);
if (refs.refreshEmpresas) refs.refreshEmpresas.addEventListener("click", loadEmpresas);
if (refs.refreshEvaluaciones) refs.refreshEvaluaciones.addEventListener("click", loadEvaluaciones);

if (refs.logoutBtn) {
  refs.logoutBtn.addEventListener("click", (e) => {
    e.preventDefault();
    state.token = "";
    state.user = null;
    state.selectedEvaluacionId = null;
    state.selectedEvaluacionRevisionId = null;
    state.answersMap = {};
    state.evaluatorCommentsMap = {};
    window.ISO.clearSession();
    updateHeader();
    setRolePanels();
    if (refs.evaluacionSeleccionadaText) refs.evaluacionSeleccionadaText.textContent = "Sin evaluacion seleccionada.";
    if (refs.respuestasContainer) refs.respuestasContainer.innerHTML = "";
    if (refs.evaluadorSeleccionText) refs.evaluadorSeleccionText.textContent = "Selecciona una evaluacion para revisar.";
    if (refs.evaluadorPreguntasContainer) refs.evaluadorPreguntasContainer.innerHTML = "";
    if (refs.soportesEvaluadorContainer) refs.soportesEvaluadorContainer.innerHTML = "";
    showToast("Sesion cerrada");
    redirectToLoginPage();

  });
}


if (refs.usersContainer) {
  refs.usersContainer.addEventListener('click', async event => {
    const button=event.target.closest('button[data-action]');
    if(!button || button.disabled)return;
    const id=Number(button.dataset.id),action=button.dataset.action;
    button.disabled=true;
    try {
      if(action==='review'){await abrirRevisionReactivacion(id);return;}
      if(action==='urgent'||action==='role'){openAccountAction(action,id);return;}
      if(action==='toggle') {
        const account=usersLoaded.find(u=>u.id===id);
        if(!account)throw Error('La cuenta ya no está en el listado.');
        if(!confirm(`${account.activo?'¿Desactivar':'¿Activar'} la cuenta de ${account.nombre}?`))return;
        await api(`/usuarios/${id}/estado`,{method:'PUT',body:JSON.stringify({activo:!account.activo})});
        showToast('Estado de acceso actualizado.');
      }
      if(action==='delete') {
        const account=usersLoaded.find(u=>u.id===id);
        if(!account||!confirm(`¿Eliminar definitivamente la cuenta ${account.nombre}? No se puede recuperar. Si existe historial, el servidor rechazará la operación.`))return;
        await api(`/usuarios/${id}`,{method:'DELETE'});showToast('Cuenta eliminada.');
      }
      await loadUsers();
    }catch(err){showToast(err.message,'error');}
    finally{button.disabled=false;}
  });
}


const representanteDialog=document.getElementById('representanteDialog');
let representanteEmpresaActual=null;
function abrirCambioRepresentante(empresaId){
  const empresa=companiesLoaded.find(x=>x.id===empresaId);
  if(!empresa || !representanteDialog)throw Error('Empresa no disponible para modificar representación.');
  const ocupados=new Set(companiesLoaded.map(x=>x.usuarioId));
  const candidatos=usersLoaded.filter(u=>u.rol==='EMPRESARIO' && u.activo && !ocupados.has(u.id));
  const selector=document.getElementById('representanteNuevo');
  selector.replaceChildren();
  for(const u of candidatos){const option=document.createElement('option');option.value=String(u.id);option.textContent=`${u.nombre} (${u.email})`;selector.append(option);}
  if(!candidatos.length)throw Error('No hay cuentas de empresa activas y sin otra representación. Crea o habilita la cuenta antes.');
  document.getElementById('representanteForm').reset();
  document.getElementById('representanteActual').textContent=`${empresa.nombre}: representante vigente ${usersLoaded.find(x=>x.id===empresa.usuarioId)?.nombre||('#'+empresa.usuarioId)}. Esta operación cambiará el acceso de todos sus proyectos.`;
  document.getElementById('representanteError').classList.add('hidden');
  representanteEmpresaActual={id:empresa.id,representanteAnteriorId:empresa.usuarioId};
  representanteDialog.showModal();
}
if(representanteDialog){
  document.getElementById('representanteCancelar').addEventListener('click',()=>representanteDialog.close());
  representanteDialog.addEventListener('close',()=>{representanteEmpresaActual=null;});
  document.getElementById('representanteForm').addEventListener('submit',async e=>{
    e.preventDefault();if(!representanteEmpresaActual)return;
    const submit=document.getElementById('representanteGuardar');if(submit.disabled)return;submit.disabled=true;
    try{
      const body={representanteAnteriorId:representanteEmpresaActual.representanteAnteriorId,
        representanteNuevoId:Number(document.getElementById('representanteNuevo').value),
        motivo:document.getElementById('representanteMotivo').value.trim(),
        constanciaValidacion:document.getElementById('representanteConstancia').value.trim(),
        representacionVerificada:document.getElementById('representanteVerificado').checked};
      const result=await api(`/empresas/${representanteEmpresaActual.id}/sustituir-representante`,{method:'POST',body:JSON.stringify(body)});
      representanteDialog.close();
      showToast(`Representante sustituido. ${result.avisosReemitidos} avisos pendientes reemitidos; ${result.actividadesReasignadas} actividades activas reasignadas.`);
      await Promise.all([loadEmpresas(),loadUsers()]);
    }catch(err){const error=document.getElementById('representanteError');error.textContent=err.message;error.classList.remove('hidden');}
    finally{submit.disabled=false;}
  });
}

// REG239: comparación visible, sin modificar datos del proveedor desde el formulario.
const conciliacionDialog=document.getElementById('conciliacionDialog');
let conciliacionEmpresaId=null;
function abrirConciliacion(id) {
  const empresa=companiesLoaded.find(x=>x.id===id);
  if(!empresa || !empresa.revisionPendiente || !empresa.bloqueoNuevosProyectos || !empresa.datosFuente)
    throw Error('La conciliación ya no está disponible. Actualiza el listado.');
  conciliacionEmpresaId=id;
  const lista=document.getElementById('conciliacionComparacion');lista.replaceChildren();
  lista.append(textoRevision(`NIT: ${empresa.nit}. Los nuevos proyectos están restringidos hasta revisión.`));
  for(const campo of ['nombre','sector','tamano']) {
    const fuente=empresa.datosFuente?.[campo]??'No informado';
    const manual=empresa.datosManual?.[campo]??'No registrado';
    lista.append(textoRevision(`${campo}: fuente «${fuente}» · ADMIN «${manual}»`));
  }
  const eleccion=document.getElementById('conciliacionEleccion');
  eleccion.value='FUENTE';
  // Sin datos ADMIN no existe una alternativa que el backend pueda conservar.
  const opcionAdmin=eleccion.querySelector('option[value="ADMIN"]');
  opcionAdmin.disabled=!empresa.datosManual;
  document.getElementById('conciliacionMotivo').value='';
  document.getElementById('conciliacionError').classList.add('hidden');
  conciliacionDialog.showModal();
}
if(conciliacionDialog) {
  document.getElementById('conciliacionCancelar').addEventListener('click',()=>conciliacionDialog.close());
  conciliacionDialog.addEventListener('close',()=>{conciliacionEmpresaId=null;});
  document.getElementById('conciliacionForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!conciliacionEmpresaId)return;
    const boton=e.currentTarget.querySelector('button[type="submit"]');
    if(boton.disabled)return;
    boton.disabled=true;
    const error=document.getElementById('conciliacionError');error.classList.add('hidden');
    try {
      await api(`/empresas/${conciliacionEmpresaId}/conciliar-datos`,{method:'POST',body:JSON.stringify({
        eleccion:document.getElementById('conciliacionEleccion').value,
        motivo:document.getElementById('conciliacionMotivo').value,
      })});
      conciliacionDialog.close();
      showToast('Conciliación registrada; la fuente y la decisión se conservan por separado.');
      await loadEmpresas();
    }catch(e){error.textContent=e.message;error.classList.remove('hidden');}
    finally{boton.disabled=false;}
  });
}

if (refs.empresasContainer) {
  refs.empresasContainer.addEventListener("click", async (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    const id = Number(button.dataset.id);
    const action = button.dataset.action;
    if(button.disabled)return;
    button.disabled=true;
    try {
      if (action === "representative") {
        abrirCambioRepresentante(id);
        return;
      }
      if (action === "conciliar") {
        abrirConciliacion(id);
        return;
      }
      await loadEmpresas();
    } catch (err) {
      showToast(err.message, "error");
    } finally { button.disabled=false; }
  });
}


if (refs.evaluacionesContainer) {
  refs.evaluacionesContainer.addEventListener("click", async (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    const id = Number(button.dataset.id);
    const action = button.dataset.action;
    try {
      if (action === "enviar") {
        const data = await api(`/evaluaciones/${id}/enviar`, { method: "POST" });
        showToast("Evaluacion enviada");
        if (data.decision?.sugerenciaIA) {
          alert(data.decision.sugerenciaIA);
        }
      }
      if (action === "responder") {
        await selectEvaluationForAnswers(id);
        showToast("Evaluacion cargada para responder");
      }
      if (action === "revisar") {
        await selectEvaluationForReview(id);
        showToast("Evaluacion cargada para revision");
      }
      if (action === "resumen") {
        const data = await api(`/evaluaciones/${id}/resumen`);
        alert(
          `Autodiagnóstico orientativo (criterios no validados)\nPromedio autodeclarado: ${data.puntajePromedio ?? "-"}\nMensaje: ${
            data.mensajeDecision || "-"
          }`
        );
      }
      if (action === "informe") {
        await downloadInformePdf(id);
        showToast("Informe PDF descargado");
      }
      loadEvaluaciones();
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}


if (refs.respuestasContainer) {
  refs.respuestasContainer.addEventListener("change", (e) => {
    const el = e.target;
    const questionId = Number(el.dataset.questionId);
    const field = el.dataset.field;
    if (!questionId || !field) return;

    if (!state.answersMap[questionId]) {
      state.answersMap[questionId] = { valor: "", comentario: "" };
    }

    if (field === "valor") {
      state.answersMap[questionId].valor = el.value === "" ? "" : Number(el.value);
    }
    if (field === "comentario") {
      state.answersMap[questionId].comentario = el.value;
    }
  });

  refs.respuestasContainer.addEventListener("input", (e) => {
    const el = e.target;
    const questionId = Number(el.dataset.questionId);
    const field = el.dataset.field;
    if (!questionId || field !== "comentario") return;

    if (!state.answersMap[questionId]) {
      state.answersMap[questionId] = { valor: "", comentario: "" };
    }
    state.answersMap[questionId].comentario = el.value;
  });
}

for (const panel of [refs.soportesContainer, refs.soportesEvaluadorContainer]) {
  panel?.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    try {
      if(btn.dataset.action==='descargar-soporte') await descargarSoporte(Number(btn.dataset.id));

    } catch (error) { showToast(error.message, 'error'); }
  });
}

if (refs.guardarRespuestasBtn) {
  refs.guardarRespuestasBtn.addEventListener('click', async () => {
    const evaluationId = state.selectedEvaluacionId;
    const selectionVersion = answerSelectionVersion;
    const button = refs.guardarRespuestasBtn;
    if (!evaluationId || button.disabled || refs.respuestasContainer.getAttribute('aria-busy') === 'true') {
      showToast('Selecciona un diagnóstico y espera a que termine de cargar.', 'error');
      return;
    }
    const respuestas = collectAnswersFromDom();
    if (!respuestas.length) {
      showToast('Selecciona al menos un nivel de respuesta antes de guardar.', 'error');
      return;
    }
    // La API decide permisos y concurrencia. El UI evita reutilizar datos de otro diagnóstico.
    if (selectionVersion !== answerSelectionVersion || evaluationId !== state.selectedEvaluacionId) return;
    button.disabled = true;
    try {
      await api(`/evaluaciones/${evaluationId}/respuestas`, {
        method: 'POST', body: JSON.stringify({respuestas}),
      });
      if (selectionVersion !== answerSelectionVersion || evaluationId !== state.selectedEvaluacionId) return;
      showToast(`Respuestas guardadas (${respuestas.length})`);
      await selectEvaluationForAnswers(evaluationId);
      void loadEvaluaciones();
    } catch (error) {
      if (selectionVersion === answerSelectionVersion) showToast(error.message, 'error');
    } finally {
      if (evaluationId === state.selectedEvaluacionId &&
          refs.respuestasContainer.getAttribute('aria-busy') !== 'true') button.disabled = false;
    }
  });
}

if (refs.soporteForm) {
  refs.soporteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.selectedEvaluacionId) {
      showToast("Selecciona una evaluacion primero", "error");
      return;
    }

    const file = refs.soporteFile?.files?.[0];
    const vencimiento = document.querySelector('#soporteVencimiento')?.value;
    if (!file) {
      showToast("Selecciona un archivo PDF", "error");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      showToast("El soporte debe ser PDF", "error");
      return;
    }

    const formData = new FormData();
    formData.append("archivo", file);
    if (refs.soporteAreaId?.value) {
      formData.append("areaId", refs.soporteAreaId.value);
    }
    if (vencimiento) {
      formData.append("fechaVencimiento", vencimiento);
    }

    try {
      const data = await api(`/soportes/${state.selectedEvaluacionId}`, {
        method: "POST",
        body: formData,
      });
      refs.soporteForm.reset();
      showToast("Soporte subido correctamente");
      showIaMessage(
        buildIaGuidance(data) || data.observacionIA || "IA: El documento fue recibido y está en revisión."
      );
      loadSoportes();
    } catch (err) {
      const guidance = buildIaGuidance(err.details);
      if (guidance) {
        showIaMessage(guidance);
      }
      showToast(err.message, "error");
    }
  });
}


if (refs.evaluadorPreguntasContainer) {
  refs.evaluadorPreguntasContainer.addEventListener("input", (e) => {
    const el = e.target;
    const questionId = Number(el.dataset.evalQuestionId);
    if (!questionId) return;
    if (!state.evaluatorCommentsMap[questionId]) {
      state.evaluatorCommentsMap[questionId] = {};
    }
    state.evaluatorCommentsMap[questionId].comentarioEvaluador = el.value;
  });
}

if (refs.guardarComentariosEvaluadorBtn) {
  refs.guardarComentariosEvaluadorBtn.addEventListener("click", async () => {
    if (!state.selectedEvaluacionRevisionId) {
      showToast("Selecciona una evaluacion para revisar", "error");
      return;
    }
    const comentarios = Object.entries(state.evaluatorCommentsMap).map(([preguntaId, v]) => ({
      preguntaId: Number(preguntaId),
      comentarioEvaluador: v.comentarioEvaluador || "",
    }));
    try {
      await api(`/evaluaciones/${state.selectedEvaluacionRevisionId}/comentarios-evaluador`, {
        method: "POST",
        body: JSON.stringify({ comentarios }),
      });
      showToast("Comentarios de evaluador guardados");
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}


if (refs.guardarRespuestasBtn) refs.guardarRespuestasBtn.disabled = true;
if (refs.guardarComentariosEvaluadorBtn) refs.guardarComentariosEvaluadorBtn.disabled = true;
checkHealth();
updateHeader();
setRolePanels();
if (state.token) {
  if (refs.areasContainer) loadAreas();
  if (refs.usersContainer) loadUsers();
  if (refs.empresasContainer) {loadEmpresas(); cargarAvisosRegistrales();}
  if (refs.evaluacionesContainer) loadEvaluaciones();
}

// Avisos de prioridad baja: listar no marca lectura; abrir detalle sí, automáticamente.
async function cargarAvisosRegistrales(){
  const lista=document.getElementById('avisosRegistralesLista');
  if(!lista || !state.user || state.user.rol!=='ADMIN')return;
  const estado=document.getElementById('avisosRegistralesEstado');
  lista.setAttribute('aria-busy','true');estado.textContent='Consultando avisos…';
  try{
    const avisos=await api('/empresas/avisos-registrales');
    if(!Array.isArray(avisos))throw Error('Respuesta de avisos inválida.');
    lista.replaceChildren();
    estado.textContent=`${avisos.length} avisos de prioridad baja disponibles.`;
    if(!avisos.length)lista.append(textoRevision('No se han registrado cambios de error.'));
    for(const aviso of avisos){
      const item=document.createElement('article');item.className='list-item';
      const texto=document.createElement('p');texto.textContent=`Empresa #${aviso.empresaId} · Error ${aviso.codigo} · ${aviso.leidaEn?'Leído':'No leído'}`;
      const abrir=document.createElement('button');abrir.type='button';abrir.className='secondary';
      abrir.dataset.avisoId=String(aviso.id);abrir.textContent='Abrir detalle';
      item.append(texto,abrir);lista.append(item);
    }
  }catch(e){lista.replaceChildren();estado.textContent='No fue posible consultar los avisos: '+e.message;}
  finally{lista.setAttribute('aria-busy','false');}
}
const listaAvisosRegistrales=document.getElementById('avisosRegistralesLista');
if(listaAvisosRegistrales){
  document.getElementById('actualizarAvisosRegistrales').addEventListener('click',cargarAvisosRegistrales);
  document.getElementById('cerrarAvisoRegistral').addEventListener('click',()=>document.getElementById('avisoRegistralDialog').close());
  listaAvisosRegistrales.addEventListener('click',async e=>{
    const boton=e.target.closest('button[data-aviso-id]');if(!boton||boton.disabled)return;
    boton.disabled=true;
    try{
      const aviso=await api(`/empresas/avisos-registrales/${Number(boton.dataset.avisoId)}`);
      const detalle=document.getElementById('avisoRegistralDetalle');detalle.replaceChildren();
      detalle.append(textoRevision(`Empresa #${aviso.empresaId} · Código: ${aviso.codigo} · Prioridad: ${aviso.prioridad}.`));
      detalle.append(textoRevision('La apertura se ha registrado automáticamente; no acredita aceptación ni comunicación externa.'));
      document.getElementById('avisoRegistralDialog').showModal();
      await cargarAvisosRegistrales();
    }catch(error){showToast(error.message,'error');}
    finally{boton.disabled=false;}
  });
}
