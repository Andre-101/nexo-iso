'use strict';
/**
 * VIS185-D01/D02, VIS189, CFG193, VIS187 - ORÁCULO PURO SIN I/O.
 * No es ruta HTTP, no hace escrituras ni autoriza mostrar un archivo.
 * Recibe hechos revalidados desde la base dentro de UNA transacción coherente;
 * nunca confiar en valores enviados desde el navegador. Una revalidación ausente
 * o no verdadera BLOQUEA. La política de clasificación sigue pendiente de C/D.
 */
const CLASES = new Set(['INFORMATIVA_CONSULTOR','DOCUMENTO_CONSULTOR','COMUNICACION_CORRECCION_EMPRESA']);
const UTC = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/;
function tiempo(s) {
  if(typeof s !== 'string' || !UTC.test(s)) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,19) !== s.slice(0,19)) return null;
  return d.getTime();
}
function idValido(x){return Number.isSafeInteger(x) && x > 0;}
function negar(motivo){return {elegible:false,motivo};}
/** Evalúa UN candidato. Debe revalidarse nuevamente en la transacción de publicación. */
function evaluarCandidatoVIS({ahora,version,ciclo,controles}={}) {
  const t = tiempo(ahora);
  if(t === null) return negar('RELOJ_NO_ACREDITADO');
  if(!version || !idValido(version.id) || !idValido(version.proyectoId) ||
    !idValido(version.numero) || !idValido(version.recursoId) || !CLASES.has(version.clase)) return negar('CLASE_O_VERSION_NO_COMUNICABLE');
  if(!ciclo || ciclo.versionId !== version.id || ciclo.proyectoId !== version.proyectoId ||
    ciclo.recursoId !== version.recursoId ||
    ciclo.estado !== 'EN_ESPERA' || !idValido(ciclo.principalId) ||
    tiempo(ciclo.revisadaEn) === null || tiempo(ciclo.venceEn) === null ||
    tiempo(ciclo.revisadaEn) > tiempo(ciclo.venceEn)) return negar('CICLO_INVALIDO_O_PAUSADO');
  if(ciclo.versionCalendario === undefined || typeof ciclo.versionCalendario !== 'string' ||
    !ciclo.versionCalendario.trim() || !Number.isInteger(ciclo.duracionMinutos) ||
    ciclo.duracionMinutos < 30 || ciclo.duracionMinutos > 480)
    return negar('CONFIGURACION_NO_CAPTURADA');
  if(t < tiempo(ciclo.venceEn)) return negar('VENTANA_NO_VENCIDA');
  const exigidos = ['mismoProyecto','versionIntacta','principalVigente','representanteVigente',
    'permisosActuales','proyectoOperable','sinPausa','comunicacionPermitida','sinRestriccionEspecial'];
  if(!controles || exigidos.some(c => controles[c] !== true)) return negar('REVALIDACION_NO_CONFORME');
  if(version.clase === 'DOCUMENTO_CONSULTOR' &&
    (controles.aceptacionDocumentalVigente !== true || controles.aceptacionVersionId !== version.id))
    return negar('ACEPTACION_DOCUMENTAL_PENDIENTE');
  return {elegible:true,motivo:'CANDIDATO_LISTO_PARA_COMMIT',versionId:version.id,
    proyectoId:version.proyectoId, venceEn:ciclo.venceEn};
}
/** Selección mínima para representante: no devuelve datos de versiones no publicadas.
 * Consultar/descargar exige validar de nuevo pertenencia y permisos en cada petición.
 * Publicada anteriormente no significa operable ni autorización vigente.
 */
function seleccionarVersionVisibleVIS({proyectoId,recursoId,versiones,acceso,ahora}={}) {
  const t = tiempo(ahora);
  if(t === null || !idValido(proyectoId) || !idValido(recursoId) || !Array.isArray(versiones) || !acceso ||
    acceso.representanteVigente !== true || acceso.mismoProyecto !== true ||
    acceso.consultaPermitida !== true) return null;
  let seleccion = null;
  for(const v of versiones){
    if(!v || v.proyectoId !== proyectoId || v.recursoId !== recursoId || !idValido(v.id) || !idValido(v.numero) ||
      v.estado !== 'PUBLICADA' || tiempo(v.publicadaEn) === null || tiempo(v.publicadaEn) > t) continue;
    if(seleccion && v.numero === seleccion.numero && v.id !== seleccion.id) return null;
    if(!seleccion || v.numero > seleccion.numero) seleccion = {id:v.id,numero:v.numero};
  }
  return seleccion;
}
module.exports = {evaluarCandidatoVIS,seleccionarVersionVisibleVIS};
