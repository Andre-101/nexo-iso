/* Presentación de actividades del expediente (sin llamadas HTTP ni autorizaciones).
 * El backend y proyectos.js siguen controlando estados, acciones y permisos.
 */
(function (root, factory) {
  'use strict';
  const ui = factory();
  if (typeof module === 'object' && module.exports) module.exports = ui;
  if (root && root.document) root.NexoActivityUI = ui;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const stateLabels = {
    PENDIENTE: 'Pendiente', EN_PROGRESO: 'En progreso', EN_REVISION: 'En revisión',
    COMPLETADA: 'Completada', CANCELADA: 'Cancelada',
  };
  function responsibleName(t, p, accounts = []) {
    if (t.asignadoAId == null) return 'Sin responsable asignado';
    if (p?.empresa?.usuarioId != null && String(t.asignadoAId) === String(p.empresa.usuarioId))
      return p.empresa.nombre;
    return (p?.participaciones || []).find(x => String(x.usuarioId) === String(t.asignadoAId))?.usuario?.nombre ||
      accounts.find(a => String(a.id) === String(t.asignadoAId))?.nombre || `Usuario #${t.asignadoAId}`;
  }
  function createCard(doc, { task, type, name, date, lines, expanded = {}, onToggle = () => {} }) {
    const elt = (tag, content, className = '') => {
      const node = doc.createElement(tag);
      if (content != null) node.textContent = String(content);
      if (className) node.className = className;
      return node;
    };
    const root = elt('article', null, 'g1-card activity-card');
    root.dataset.taskId = String(task.id);
    const heading = elt('header', null, 'activity-card-header');
    const titleBlock = elt('div', null, 'activity-card-heading');
    titleBlock.append(elt('p', `Actividad #${task.id} · ${type}`, 'activity-card-eyebrow'),
      elt('h4', task.titulo || `Actividad #${task.id}`, 'activity-card-title'));
    const state = elt('span', stateLabels[task.estado] || String(task.estado).replace(/_/g, ' '), 'activity-state');
    state.dataset.state = task.estado;
    heading.append(titleBlock, state);
    const facts = elt('dl', null, 'activity-card-facts');
    const addFact = (label, value) => {
      const pair = elt('div', null, 'activity-card-fact');
      pair.append(elt('dt', label), elt('dd', value));
      facts.append(pair);
    };
    addFact('Responsable', name);
    addFact('Fecha objetivo', date);
    const activeBreaches = (task.brechas || []).filter(b => !b.excluidaEn);
    addFact('Brechas vigentes', activeBreaches.length ? activeBreaches.map(b => `#${b.brechaId}`).join(', ') : 'Sin vínculos vigentes');
    const actions = elt('div', null, 'activity-primary-actions');
    const info = elt('details', null, 'activity-more-info');
    info.open = Boolean(expanded.info);
    const infoContent = elt('div', null, 'activity-detail-body');
    for (const line of lines) infoContent.append(elt('p', line, 'g1-muted'));
    info.append(elt('summary', 'Información y vínculos'), infoContent);
    const tools = elt('details', null, 'activity-more-tools');
    tools.open = Boolean(expanded.tools);
    const toolBody = elt('div', null, 'activity-tool-body');
    const verifyTools = elt('div', null, 'activity-tool-group');
    verifyTools.append(elt('h5', 'Verificación e historial'));
    const managementTools = elt('div', null, 'activity-tool-group');
    managementTools.append(elt('h5', 'Gestión de la actividad'));
    toolBody.append(verifyTools, managementTools);
    tools.append(elt('summary', 'Ver historial y gestionar'), toolBody);
    root.append(heading, facts, actions, info, tools);
    for (const [panel, key] of [[info, 'info'], [tools, 'tools']]) {
      panel.addEventListener('toggle', () => { if (root.isConnected) onToggle(key, panel.open); });
    }
    return { root, actions, verifyTools, managementTools };
  }
  return { responsibleName, createCard };
});
