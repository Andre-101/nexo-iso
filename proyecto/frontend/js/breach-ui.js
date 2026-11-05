/* Presentación y métricas descriptivas de brechas. Sin HTTP ni decisión de cumplimiento. */
(function (root, factory) {
  'use strict';
  const ui = factory();
  if (typeof module === 'object' && module.exports) module.exports = ui;
  if (root && root.document) root.NexoBreachUI = ui;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const statusLabels = {
    ABIERTA: 'Abierta', EN_TRATAMIENTO: 'En tratamiento',
    PROPUESTA_CIERRE: 'Cierre propuesto', CERRADA: 'Cerrada'
  };
  const taskLabels = {
    PENDIENTE: 'Pendiente', EN_PROGRESO: 'En progreso',
    EN_REVISION: 'En revisión', COMPLETADA: 'Completada', CANCELADA: 'Cancelada'
  };
  const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  function summarize(breaches, activities) {
    const tasks = Array.isArray(activities) ? activities : [];
    const items = (Array.isArray(breaches) ? breaches : []).map(breach => {
      const current = [], excluded = [];
      // El modelo relación es independiente del estado de la actividad.
      for (const task of tasks) {
        const links = Array.isArray(task.brechas) ? task.brechas : [];
        if (links.some(link => String(link.brechaId) === String(breach.id) && !link.excluidaEn)) current.push(task);
        else if (links.some(link => String(link.brechaId) === String(breach.id) && !!link.excluidaEn)) excluded.push(task);
      }
      const counts = Object.fromEntries(Object.keys(taskLabels).map(state =>
        [state, current.filter(task => task.estado === state).length]));
      const unfinished = counts.PENDIENTE + counts.EN_PROGRESO + counts.EN_REVISION;
      return { breach, current, excluded, counts, unfinished,
        hasFollowup: breach.estado !== 'CERRADA' && (unfinished > 0 || !current.length || counts.CANCELADA > 0) };
    });
    const statuses = Object.fromEntries(Object.keys(statusLabels).map(state =>
      [state, items.filter(item => item.breach.estado === state).length]));
    return { items, statuses, total: items.length,
      currentLinks: items.reduce((n, item) => n + item.current.length, 0) };
  }
  function matches(item, query, state, followup) {
    if (state !== 'TODAS' && item.breach.estado !== state) return false;
    if (followup && !item.hasFollowup) return false;
    return clean(`#${item.breach.id} ${item.breach.titulo} ${item.breach.descripcion} ${item.breach.criterio}`).includes(clean(query).trim());
  }
  function createProgress(doc, item, onTask) {
    const node = (tag, text, className) => {
      const el = doc.createElement(tag);
      if (text != null) el.textContent = String(text);
      if (className) el.className = className;
      return el;
    };
    const wrap = node('section', null, 'breach-progress');
    wrap.setAttribute('aria-label', `Seguimiento de actividades de brecha #${item.breach.id}`);
    const facts = node('dl', null, 'breach-progress-facts');
    for (const [name, value] of [
      ['Vínculos vigentes', item.current.length],
      ['Sin completar', item.unfinished],
      ['Completadas', item.counts.COMPLETADA],
      ['Canceladas', item.counts.CANCELADA]
    ]) {
      const pair = node('div', null, 'breach-progress-fact');
      pair.append(node('dt', name), node('dd', value)); facts.append(pair);
    }
    wrap.append(facts);
    const hint = item.current.length === 0 ? 'Sin actividades vinculadas vigentes en esta consulta.' :
      item.unfinished ? `${item.unfinished} actividad(es) todavía sin completar. Revisa su estado y antecedentes.` :
      item.counts.CANCELADA ? 'Hay actividades canceladas: consulta su continuidad y constancias auditadas.' :
      'No hay actividades vigentes sin completar. Consulta igualmente los documentos, las verificaciones y el historial.';
    wrap.append(node('p', hint, 'breach-progress-hint'));
    if (item.current.length) {
      const details = node('details', null, 'breach-activity-list');
      details.append(node('summary', `Ver actividades vinculadas (${item.current.length})`));
      const list = node('ul');
      for (const task of item.current) {
        const line = node('li');
        const button = node('button', `#${task.id} · ${task.titulo || 'Actividad'} · ${taskLabels[task.estado] || task.estado}`, 'secondary');
        button.type = 'button';
        button.addEventListener('click', () => onTask(task.id));
        line.append(button); list.append(line);
      }
      details.append(list); wrap.append(details);
    }
    if (item.excluded.length) {
      const details = node('details', null, 'breach-exclusions');
      details.append(node('summary', `Vínculos excluidos del alcance vigente (${item.excluded.length})`));
      const note = node('p', 'Son antecedentes históricos. La exclusión no demuestra cumplimiento ni invalida otras relaciones.');
      details.append(note);
      const list = node('ul');
      for (const task of item.excluded) {
        const li = node('li', `Actividad #${task.id} · ${task.titulo || 'Sin título'}`);list.append(li);
      }
      details.append(list);wrap.append(details);
    }
    wrap.append(node('p', 'Los conteos describen actividades, no certifican verificaciones ni autorizan cerrar la brecha.', 'breach-progress-disclaimer'));
    return wrap;
  }
  return { statusLabels, taskLabels, summarize, matches, createProgress };
});
