/**
 * Permisos de aporte documental derivados de RN-14, SOL-02 y SOL-52.
 * La pertenencia al proyecto se valida por separado con autorizar().
 * No concede aprobación documental ni sustitución de responsabilidades.
 */
function puedeAportarVersion(rol, usuarioId, actividad) {
  if (!actividad || actividad.asignadoAId !== usuarioId) return false;
  if (actividad.tipoResponsable === 'CLIENTE') return Boolean(rol?.cliente);
  if (actividad.tipoResponsable === 'CONSULTORA') return Boolean(rol?.consultor && !rol?.lider);
  return false;
}
module.exports = { puedeAportarVersion };
