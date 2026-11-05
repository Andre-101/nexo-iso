'use strict';
/**
 * Oráculo de contraste NACIONAL 2026, NO configura ni activa VIS.
 * Referencias legales: Ley 51/1983 (festivos trasladables) y Ley 2578/2026
 * (festivo del 9 de julio, traslado al lunes 13/07/2026).
 * La activación sigue requiriendo validación administrativa de fuente, versión,
 * horarios, cierres y efectos de la configuración, que esta utilidad NO concede.
 * No inventar un calendario 2027 extrapolando 2026: la normativa puede cambiar.
 */
const {validarCalendario} = require('./vis-calendario-laboral');
const NACIONALES_2026 = Object.freeze([
  '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03',
  '2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29',
  '2026-07-13','2026-07-20','2026-08-07','2026-08-17','2026-10-12',
  '2026-11-02','2026-11-16','2026-12-08','2026-12-25'
]);
const FUENTES = Object.freeze([
 'https://dapre.presidencia.gov.co/normativa/normativa/LEY%20No.%202578%20DEL%2001%20DE%20JUNIO%20DE%202026.pdf',
 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php/norma.php?i=4954'
]);
const fallo = code => Object.assign(new Error(code), {code});
function compararFestivosNacionales2026(fechas) {
  if (!Array.isArray(fechas) || fechas.some(f => typeof f !== 'string'))
    throw fallo('VIS_CATALOGO_2026_INVALIDO');
  const actual = new Set(fechas);
  const referencia = new Set(NACIONALES_2026);
  return {
    coincide: actual.size === fechas.length && actual.size === referencia.size &&
      [...referencia].every(f => actual.has(f)),
    faltantes: NACIONALES_2026.filter(f => !actual.has(f)),
    sobrantes: [...actual].filter(f => !referencia.has(f)).sort(),
    duplicados: fechas.length - actual.size,
    referencia: 'LEY_51_1983_Y_LEY_2578_2026',
  };
}
/** Control adicional explícito, no substituye el catálogo firmado por ADMIN. */
function contrastarCalendarioVIS2026(calendario) {
  validarCalendario(calendario);
  const catalogo = calendario.festivosPorAnio['2026'];
  if (!catalogo) throw fallo('VIS_CATALOGO_2026_AUSENTE');
  const resultado = compararFestivosNacionales2026(catalogo.fechas);
  if (!resultado.coincide) throw Object.assign(fallo('VIS_FESTIVOS_2026_NO_COINCIDEN'), {detalle: resultado});
  return {coincide:true, version:calendario.version, referencia: resultado.referencia};
}
module.exports = {NACIONALES_2026,FUENTES,compararFestivosNacionales2026,contrastarCalendarioVIS2026};
