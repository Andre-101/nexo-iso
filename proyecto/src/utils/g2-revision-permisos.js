/** Revisión del aporte sin conflicto de intereses (SOL-02, SOL-17, SOL-49, Q-55). */
'use strict';
function puedeRevisarVersion(rol, usuarioId, actividad, version) {
  if (!rol?.consultor || !actividad || !version || usuarioId === version.subidoPorId) return false;
  if (actividad.tipoResponsable === 'CONSULTORA') return Boolean(rol.lider);
  if (actividad.tipoResponsable !== 'CLIENTE') return false;
  if (version.estadoCoelaboracion === 'DECLARADA' || version.estadoCoelaboracion === 'RECHAZADA') return false;
  if (version.estadoCoelaboracion === 'CONFIRMADA') return Boolean(rol.lider) && usuarioId !== version.consultorCoautorId;
  // Antes de resolver una revisión de aportes CLIENTE debe existir encargado explícito.
  return actividad.consultorRevisorId === usuarioId && !rol.lider;
}
module.exports = { puedeRevisarVersion };
