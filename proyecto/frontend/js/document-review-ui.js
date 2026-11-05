/* Presentación del estado documental. Sin acceso a red ni decisiones de autorización.
 * Fuente: GET /proyectos/:id/entregables (versiones ordenadas por numero descendente).
 */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  if (root && root.document) root.NexoDocumentReviewUI = value;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const STATES = ['TODAS', 'CORRECCION_REQUERIDA', 'PENDIENTE', 'SIN_VERSION', 'ACEPTADA', 'OTROS'];
  const LABELS = Object.freeze({
    TODAS: 'Todos', CORRECCION_REQUERIDA: 'Requiere corrección',
    PENDIENTE: 'Pendiente de revisión', SIN_VERSION: 'Sin versión',
    ACEPTADA: 'Aceptado documentalmente', OTROS: 'Otros estados',
  });
  const ORDER = Object.freeze({ CORRECCION_REQUERIDA: 0, PENDIENTE: 1, SIN_VERSION: 2, OTROS: 3, ACEPTADA: 4 });
  function currentVersion(delivery) { return Array.isArray(delivery?.versiones) ? (delivery.versiones[0] || null) : null; }
  function reviewState(delivery) {
    const last = currentVersion(delivery);
    if (!last) return 'SIN_VERSION';
    return ['PENDIENTE', 'CORRECCION_REQUERIDA', 'ACEPTADA'].includes(last.estadoRevision) ? last.estadoRevision : 'OTROS';
  }
  function description(delivery) {
    const state = reviewState(delivery), version = currentVersion(delivery);
    if (state === 'SIN_VERSION') return 'Aún no se ha presentado un PDF para revisar.';
    if (state === 'CORRECCION_REQUERIDA') return 'Consulta la observación registrada y prepara una nueva versión si tienes permiso para aportarla.';
    if (state === 'ACEPTADA') return 'La versión fue aceptada documentalmente. La verificación de implementación es independiente.';
    if (state === 'PENDIENTE' && version.estadoCoelaboracion === 'DECLARADA')
      return 'La coelaboración declarada requiere respuesta del consultor señalado antes de continuar la revisión.';
    if (state === 'PENDIENTE') return 'La versión está pendiente de la decisión documental del revisor autorizado.';
    return 'Consulta el historial. El estado recibido no está contemplado por esta vista.';
  }
  function counts(deliveries) {
    const summary = Object.fromEntries(STATES.map(state => [state, 0]));
    for (const d of deliveries) { summary.TODAS++; summary[reviewState(d)]++; }
    return summary;
  }
  function simplify(value) { return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim(); }
  function matches(delivery, { state = 'TODAS', search = '' } = {}) {
    if (state !== 'TODAS' && reviewState(delivery) !== state) return false;
    const needle = simplify(search);
    if (!needle) return true;
    return simplify([delivery.id, delivery.titulo, delivery.actividadId, delivery.criterio].join(' ')).includes(needle);
  }
  function compare(a, b, order = 'prioridad') {
    if (order === 'titulo') return String(a.titulo ?? '').localeCompare(String(b.titulo ?? ''), 'es') || Number(b.id) - Number(a.id);
    if (order === 'actividad') return Number(a.actividadId) - Number(b.actividadId) || Number(b.id) - Number(a.id);
    return ORDER[reviewState(a)] - ORDER[reviewState(b)] || Number(b.id) - Number(a.id);
  }
  function visible(deliveries, filters = {}) {
    return deliveries.filter(item => matches(item, filters)).sort((a, b) => compare(a, b, filters.order));
  }
  function decisionGuide(result) {
    if (result === 'CORRECCION_REQUERIDA')
      return 'Describe observaciones concretas y los ajustes necesarios. Se solicitará una nueva versión del documento.';
    if (result === 'ACEPTADA')
      return 'Se aceptará esta versión documental. La verificación de implementación es un proceso independiente.';
    return 'Selecciona una decisión después de consultar el PDF. No hay ninguna decisión preseleccionada.';
  }
  return { STATES, LABELS, currentVersion, reviewState, description, counts, matches, visible, decisionGuide };
});
