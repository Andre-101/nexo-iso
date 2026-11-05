/* Presentación del diagnóstico: resumen y filtros sin deducir cumplimiento ni vínculos implícitos. */
(function (root, factory) {
  'use strict';
  const ui=factory();
  if (typeof module==='object' && module.exports) module.exports=ui;
  if (root && root.document) root.NexoDiagnosisUI=ui;
})(typeof globalThis!=='undefined' ? globalThis : null, function () {
  'use strict';
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  const hasObservation=answer=>Boolean(String(answer?.comentarioEvaluador??'').trim());
  function summarize(answers) {
    const rows=Array.isArray(answers)?answers:[];
    return {total:rows.length,observed:rows.filter(hasObservation).length,
      withoutObservation:rows.filter(answer=>!hasObservation(answer)).length,
      declared:rows.filter(answer=>answer.valor!==null && answer.valor!==undefined).length};
  }
  function matches(answer,query,filter) {
    if(filter==='CON_OBSERVACION' && !hasObservation(answer))return false;
    if(filter==='SIN_OBSERVACION' && hasObservation(answer))return false;
    return normalize([answer.pregunta?.texto,answer.comentarioEvaluador,answer.actualizadaPor?.nombre,
      answer.preguntaId,answer.comentario].join(' ')).includes(normalize(query).trim());
  }
  function relatedBreaches(breaches,diagnosisId) {
    return (Array.isArray(breaches)?breaches:[]).filter(b=>
      b.origenEvaluacionId!==null && b.origenEvaluacionId!==undefined &&
      String(b.origenEvaluacionId)===String(diagnosisId));
  }
  return {hasObservation,summarize,matches,relatedBreaches};
});
