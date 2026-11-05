/* Seguimiento visual de correcciones. No autoriza acciones ni cambia estados del SGSI.
 * La API sigue siendo la autoridad para permisos, versión vigente y revisiones.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) root.NexoDocumentFollowupUI = api;
})(typeof globalThis === 'undefined' ? null : globalThis, function () {
  'use strict';
  const same = (a, b) => a != null && b != null && String(a) === String(b);
  function mayUpload(activity, context = {}) {
    if (!activity || !context.active || ['COMPLETADA','CANCELADA'].includes(activity.estado) ||
        !same(activity.asignadoAId, context.userId)) return false;
    if (activity.tipoResponsable === 'CLIENTE')
      return context.role === 'EMPRESARIO' && same(context.companyUserId, context.userId);
    if (activity.tipoResponsable === 'CONSULTORA')
      return context.role === 'EVALUADOR' && context.consultor === true && context.lider !== true;
    return false;
  }
  function needsMyCorrection(delivery, activity, context) {
    return delivery?.versiones?.[0]?.estadoRevision === 'CORRECCION_REQUERIDA' && mayUpload(activity, context);
  }
  function followUp(delivery) {
    const versions = Array.isArray(delivery?.versiones) ? delivery.versiones : [];
    const latest = versions[0] || null;
    // Sólo la versión inmediatamente anterior permite inferir que este PDF responde
    // a una corrección. Una aceptación intermedia rompe el ciclo anterior.
    const previousRequest = versions[1]?.estadoRevision === 'CORRECCION_REQUERIDA' ? versions[1] : null;
    if (latest?.estadoRevision === 'CORRECCION_REQUERIDA') return {
      kind:'correction', heading:'Corrección documental solicitada',
      message:'Revisa la observación, prepara el PDF corregido y presenta una nueva versión si eres la persona autorizada.',
      observation:latest.revision?.observacion || '', reference:latest,
    };
    if (latest?.estadoRevision === 'PENDIENTE' && previousRequest) return {
      kind:'resubmitted', heading:'Nueva versión presentada para revisión',
      message:`La versión ${latest.numero} está pendiente de decisión documental. La solicitud anterior permanece en el historial; todavía no implica aceptación.`,
      observation:previousRequest.revision?.observacion || '', reference:previousRequest,
    };
    return null;
  }
  return { mayUpload, needsMyCorrection, followUp };
});
