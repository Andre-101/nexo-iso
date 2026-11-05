/* Presentación de verificaciones operativas, sin HTTP, autorización ni dictámenes.
 * La API determina qué puede consultar o registrar cada usuario.
 */
(function (root, factory) {
  'use strict';
  const ui = factory();
  if (typeof module === 'object' && module.exports) module.exports = ui;
  if (root && root.document) root.NexoVerificationUI = ui;
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const RESULTS = Object.freeze({
    VERIFICADA: 'Verificada', NO_VERIFICADA: 'No verificada', NO_APLICA: 'No aplica',
  });
  function resultLabel(result) {
    return RESULTS[result] || 'Resultado no reconocido';
  }
  function dateLabel(value) {
    if (!value || typeof value !== 'string') return 'Fecha no disponible';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Fecha no disponible' :
      new Intl.DateTimeFormat('es-CO', {day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
  }
  function create(doc, tag, text, className) {
    const node=doc.createElement(tag);
    if (text != null) node.textContent=String(text);
    if (className) node.className=className;
    return node;
  }
  function renderHistory(target, entries) {
    if (!Array.isArray(entries)) throw new TypeError('Lista de verificaciones inválida');
    const doc=target.ownerDocument;
    const body=doc.createDocumentFragment();
    const heading=create(doc,'h4',`Antecedentes operativos (${entries.length})`);
    body.append(heading);
    if (!entries.length) body.append(create(doc,'p','Esta actividad todavía no tiene verificaciones registradas.','g1-muted'));
    for (const entry of entries) {
      const article=create(doc,'article',null,'verification-record');
      const head=create(doc,'div',null,'verification-record-header');
      const badge=create(doc,'span',resultLabel(entry.resultado),'verification-result');
      // Estado desconocido nunca se presenta como una verificación favorable.
      badge.dataset.result=Object.hasOwn(RESULTS, entry.resultado) ? entry.resultado : 'OTRO';
      head.append(badge,create(doc,'time',dateLabel(entry.verificadoEn),'g1-muted'));
      const details=create(doc,'dl',null,'verification-record-fields');
      for(const [name,value] of [
        ['Método', entry.metodo],['Evidencia observada',entry.evidencia],
        ['Justificación',entry.justificacion]
      ]) {
        const item=create(doc,'div');
        item.append(create(doc,'dt',name),create(doc,'dd',value || 'No registrada'));
        details.append(item);
      }
      article.append(head,details);
      body.append(article);
    }
    target.replaceChildren(body);
  }
  function selectionMessage(activity) {
    return activity ? `Consulta el historial operativo de la actividad #${activity.id} antes de registrar una nueva verificación. La revisión del PDF es independiente.` :
      'Selecciona una actividad en revisión para consultar sus verificaciones previas.';
  }
  return {RESULTS, resultLabel, dateLabel, renderHistory, selectionMessage};
});
