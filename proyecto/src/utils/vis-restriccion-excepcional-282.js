'use strict';
/**
 * F3-ANA-282. Regla PURA para restringir excepcionalmente la exposición de un
 * recurso previamente publicado. NO ejecuta endpoints, SQL, notificaciones ni
 * borrado. Sólo consume hechos de autorización verificados por el servidor.
 *
 * La restricción se aplica al RECURSO ENTERO: no mostrar versiones antiguas por
 * fallback mientras se atiende el incidente. Las copias ya descargadas no
 * pueden revocarse mediante software; la remediación requiere gestión externa.
 */
const {seleccionarVersionVisibleVIS} = require('./vis-politica-publicacion');
const ISO = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/;
const MOTIVOS = new Set(['ERROR_GRAVE','DIVULGACION_INDEBIDA']);
const esId = x => Number.isSafeInteger(x) && x > 0;
function error(codigo) {return Object.assign(new Error(codigo), {code:codigo});}
function exige(ok,codigo){if(!ok) throw error(codigo);}
function fechaValida(s){
  if(typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) && d.toISOString() === (s.includes('.') ? s : s.replace('Z','.000Z'));
}
function estadoValido(e){
  return e && esId(e.proyectoId) && esId(e.recursoId) &&
    ['SIN_RESTRICCION','RESTRINGIDO'].includes(e.estado) &&
    Number.isSafeInteger(e.revision) && e.revision >= 0 && Array.isArray(e.eventos) &&
    e.eventos.length === e.revision &&
    (e.estado === 'SIN_RESTRICCION' ?
      (e.revision === 0 && e.versionObjetivoId === null && e.restringidaEn === null) :
      (e.revision === 1 && esId(e.versionObjetivoId) && fechaValida(e.restringidaEn) &&
        e.eventos[0]?.tipo === 'RESTRICCION_EXCEPCIONAL' &&
        e.eventos[0]?.revision === 1 && e.eventos[0]?.versionId === e.versionObjetivoId &&
        e.eventos[0]?.en === e.restringidaEn));
}
function crearEstadoRestriccionVIS({proyectoId,recursoId}={}){
  exige(esId(proyectoId) && esId(recursoId), 'VIS282_IDENTIFICADORES_INVALIDOS');
  return {proyectoId,recursoId,estado:'SIN_RESTRICCION',revision:0,
    versionObjetivoId:null,restringidaEn:null,eventos:[]};
}
/**
 * El actor y los permisos nunca deben provenir del body HTTP; son una foto
 * obtenida en transacción de la BD. El historial conserva datos mínimos del
 * incidente pero NO el documento, contenido divulgado o datos sensibles.
 */
function restringirPublicacionVIS({estado,versionPublicada,orden,autorizacion}={}){
  exige(estadoValido(estado), 'VIS282_ESTADO_INVALIDO');
  exige(orden && Number.isSafeInteger(orden.revisionEsperada) &&
    orden.revisionEsperada === estado.revision, 'VIS282_CONFLICTO_REVISION');
  exige(estado.estado === 'SIN_RESTRICCION', 'VIS282_YA_RESTRINGIDO');
  exige(versionPublicada && esId(versionPublicada.id) &&
    versionPublicada.proyectoId === estado.proyectoId &&
    versionPublicada.recursoId === estado.recursoId &&
    versionPublicada.estado === 'PUBLICADA' && fechaValida(versionPublicada.publicadaEn),
    'VIS282_VERSION_NO_PUBLICADA_O_AJENA');
  exige(MOTIVOS.has(orden.motivo) && typeof orden.justificacion === 'string' &&
    orden.justificacion.trim().length >= 20 && orden.justificacion.trim().length <= 1000 &&
    fechaValida(orden.en) && new Date(orden.en).getTime() >= new Date(versionPublicada.publicadaEn).getTime(),
    'VIS282_MOTIVO_O_FECHA_INVALIDA');
  exige(autorizacion && autorizacion.mismoProyecto === true &&
    autorizacion.mismoRecurso === true && autorizacion.autoridadExcepcionalVigente === true &&
    autorizacion.actorActivo === true && autorizacion.revalidacionAtomica === true &&
    esId(autorizacion.actorId) && autorizacion.actorId === orden.actorId &&
    autorizacion.versionPublicadaVigenteId === versionPublicada.id &&
    autorizacion.operacionExcepcionalPermitida === true,
    'VIS282_AUTORIZACION_NO_ACREDITADA');
  const evento = {revision:estado.revision+1,tipo:'RESTRICCION_EXCEPCIONAL',
    versionId:versionPublicada.id, actorId:orden.actorId, motivo:orden.motivo,
    justificacion:orden.justificacion.trim(), en:orden.en,
    comunicacion:'PENDIENTE_GESTION',conservacion:'NO_DESTRUIR_ORIGINAL'};
  return {...estado,estado:'RESTRINGIDO',revision:estado.revision+1,
    versionObjetivoId:versionPublicada.id,restringidaEn:orden.en,
    eventos:[...estado.eventos,evento]};
}
/**
 * Consulta/descarga desde representante: DENEGAR si no hay estado confiable,
 * está restringido o hay incoherencias. No devolver la versión anterior.
 * No incorpora una operación de levantamiento: requerirá reglas y revisión.
 */
function seleccionarVersionExternaConRestriccionVIS({proyectoId,recursoId,versiones,acceso,ahora,restriccion}={}) {
  if(!estadoValido(restriccion) || restriccion.proyectoId !== proyectoId ||
    restriccion.recursoId !== recursoId || restriccion.estado !== 'SIN_RESTRICCION') return null;
  return seleccionarVersionVisibleVIS({proyectoId,recursoId,versiones,acceso,ahora});
}
/** Una comprobación estricta para descargas por ID; nunca confiar en que
 * la selección del listado conceda acceso a archivos. */
function permitirDescargaConRestriccionVIS({proyectoId,recursoId,versionId,restriccion,autorizacion}={}) {
  return Boolean(estadoValido(restriccion) && restriccion.estado === 'SIN_RESTRICCION' &&
    restriccion.proyectoId === proyectoId && restriccion.recursoId === recursoId &&
    esId(versionId) && autorizacion && autorizacion.mismoProyecto === true &&
    autorizacion.mismoRecurso === true && autorizacion.representanteVigente === true &&
    autorizacion.versionPublicadaAutorizadaId === versionId &&
    autorizacion.revalidacionAtomica === true);
}
module.exports={crearEstadoRestriccionVIS,restringirPublicacionVIS,
  seleccionarVersionExternaConRestriccionVIS,permitirDescargaConRestriccionVIS};
