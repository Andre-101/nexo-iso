/* Pure, testable logic for the orientation-only SGIA form. Not an ISO conformity test. */
(function (root, factory) {
  'use strict';
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root && root.document) root.NexoMaturityModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const LEVELS = new Set(['0', '1', '2', '3', '4', 'NA']);
  function normalizeAnswer(value) {
    const a = value && typeof value === 'object' ? value : {};
    return {
      valor: LEVELS.has(a.valor) ? a.valor : '',
      evidencia: String(a.evidencia ?? '').trim().slice(0, 180),
      justificacion: String(a.justificacion ?? '').trim().slice(0, 500),
    };
  }
  function isComplete(value) {
    const a = normalizeAnswer(value);
    return a.valor !== '' && (a.valor !== 'NA' || a.justificacion.length >= 10);
  }
  function summary(questions, answers) {
    const rows = questions.map(q => ({id:q.id, respuesta:normalizeAnswer(answers.get(q.id))}));
    const completed = rows.filter(r => isComplete(r.respuesta)).length;
    const invalidNA = rows.filter(r => r.respuesta.valor === 'NA' && !isComplete(r.respuesta)).length;
    return { rows, completed, pending: rows.length - completed, invalidNA };
  }
  function exportDraft(questions, answers, projectId) {
    const result = summary(questions, answers);
    return {
      tipo: 'BORRADOR_ORIENTATIVO_NO_APROBADO',
      norma: 'ISO/IEC 42001:2023',
      proyectoId: /^\d+$/.test(String(projectId)) ? String(projectId) : null,
      autoriaVerificada: false,
      almacenamientoServidor: false,
      advertencia: 'Sin conclusión de conformidad. La identidad del autor no se acredita en este borrador local. Revisar evidencia y autorización antes de archivar.',
      conteo: {total: questions.length, completas: result.completed, pendientes: result.pending},
      respuestas: result.rows,
    };
  }
  return { normalizeAnswer, isComplete, summary, exportDraft };
});
