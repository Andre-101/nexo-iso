'use strict';
/**
 * F3-ANA-280: motor de estado PURO del ciclo VIS para una versión comunicable.
 * Sin I/O, rutas, aceptación G2 ni efecto de publicación. Solo acepta hechos de
 * autorización revalidados en servidor (NO se reciben de un cliente HTTP).
 * Decisiones: F3-ANA-182/183, VIS185-D01/D02, CFG193-D01-A.
 * Cada transición devuelve un registro NUEVO; nunca modifica el recibido.
 */
const {capturarCicloVIS} = require('./vis-configuracion-admin');
const {evaluarCandidatoVIS} = require('./vis-politica-publicacion');
const UTC = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/;
const CLASES = new Set(['INFORMATIVA_CONSULTOR','DOCUMENTO_CONSULTOR','COMUNICACION_CORRECCION_EMPRESA']);
const EVENTOS = new Set(['INSPECCION_PRINCIPAL','PAUSA','CORRECCION','INVALIDACION_PRINCIPAL']);
function fallo(code){return Object.assign(new Error(code),{code});}
function exigir(ok,code){if(!ok) throw fallo(code);}
function id(n){return Number.isSafeInteger(n)&&n>0;}
function instante(s){
  exigir(typeof s==='string'&&UTC.test(s),'VIS280_RELOJ_INVALIDO');
  const d=new Date(s);
  exigir(Number.isFinite(d.getTime())&&d.toISOString()=== (s.includes('.')?s:s.replace('Z','.000Z')),
    'VIS280_RELOJ_INVALIDO');
  return d.getTime();
}
function huella(h){return typeof h==='string'&&/^[0-9a-f]{64}$/.test(h);}
function clonar(o){return structuredClone(o);}
function validarVersion(v){
  exigir(v && id(v.id)&&id(v.numero)&&id(v.proyectoId)&&id(v.recursoId)&&id(v.autorId)&&
    CLASES.has(v.clase)&&huella(v.sha256)&&typeof v.creadaEn==='string', 'VIS280_VERSION_INVALIDA');
  instante(v.creadaEn);
}
function crearEstadoVIS({version}={}){
  validarVersion(version);
  return {revision:0,version:clonar(version),estado:'PENDIENTE_INSPECCION',ciclo:null,
    eventos:[],ultimoEventoEn:version.creadaEn};
}
function fechaEvento(x,previa){
  const n=instante(x);
  exigir(n>=instante(previa),'VIS280_EVENTO_RETROACTIVO');
  return n;
}
function comprobarActor(evento,permisos,version){
  exigir(permisos&&permisos.mismoProyecto===true&&permisos.proyectoOperable===true&&
    permisos.versionIntacta===true && permisos.sinRestriccionEspecial===true &&
    id(evento.actorId)&&id(permisos.principalVigenteId), 'VIS280_PERMISOS_NO_VERIFICADOS');
  exigir(version.proyectoId===permisos.proyectoId && version.recursoId===permisos.recursoId,
    'VIS280_RECURSO_NO_COINCIDE');
  if(evento.tipo!=='INVALIDACION_PRINCIPAL')
    exigir(permisos.participacionVigente===true,'VIS280_PARTICIPACION_NO_VIGENTE');
}
/**
 * CAS lógico contra evento concurrente; la BD necesita además CAS/lock propios.
 * `permisos` es una foto interna verificada (nunca el body HTTP).
 * La revisión del principal NO equivale a aceptación documental.
 */
function transicionarVIS({estado,evento,permisos,configuracion}={}){
  exigir(estado&&Number.isSafeInteger(estado.revision)&&estado.revision>=0&&
    estado.version&&Array.isArray(estado.eventos)&&
    typeof estado.ultimoEventoEn==='string','VIS280_ESTADO_INVALIDO');
  validarVersion(estado.version);
  exigir(evento&&EVENTOS.has(evento.tipo)&&Number.isSafeInteger(evento.revisionEsperada)&&
    evento.revisionEsperada===estado.revision,'VIS280_REVISION_OBSOLETA');
  fechaEvento(evento.en,estado.ultimoEventoEn);
  comprobarActor(evento,permisos,estado.version);
  const nuevo=clonar(estado);
  const anterior=estado.version;
  let detalle;
  switch(evento.tipo){
    case 'INSPECCION_PRINCIPAL':{
      exigir(estado.estado==='PENDIENTE_INSPECCION','VIS280_ESTADO_NO_REVISABLE');
      exigir(evento.actorId===permisos.principalVigenteId&&
        evento.versionId===anterior.id&&evento.intencional===true&&
        permisos.puedeInspeccionar===true,'VIS280_INSPECCION_NO_ACREDITADA');
      const captura=capturarCicloVIS({configuracion,inicio:evento.en});
      nuevo.estado='EN_ESPERA';
      nuevo.ciclo={versionId:anterior.id,proyectoId:anterior.proyectoId,recursoId:anterior.recursoId,
        estado:'EN_ESPERA',principalId:evento.actorId,revisadaEn:evento.en,
        inicio:captura.inicio,venceEn:captura.venceEn,
        duracionMinutos:captura.duracionMinutos,versionCalendario:captura.versionCalendario,
        configuracionId:captura.configuracionId,calendarioCapturado:captura.calendarioCapturado};
      detalle='INSPECCION_INTENCIONAL';
      break;
    }
    case 'PAUSA':{
      exigir(estado.estado==='EN_ESPERA'&&estado.ciclo?.versionId===anterior.id,
        'VIS280_PAUSA_NO_ADMITIDA');
      exigir(evento.versionId===anterior.id &&
        (evento.actorId===permisos.principalVigenteId ? permisos.puedePausarPrincipal===true :
          permisos.esResponsableDePieza===true&&permisos.puedePausarResponsable===true),
        'VIS280_PAUSA_NO_AUTORIZADA');
      nuevo.estado='PAUSADA';
      nuevo.ciclo.estado='PAUSADA';
      detalle='PLAZO_INVALIDADO';
      break;
    }
    case 'CORRECCION':{
      exigir(['PAUSADA','EN_ESPERA','PENDIENTE_INSPECCION'].includes(estado.estado),
        'VIS280_CORRECCION_NO_ADMITIDA');
      exigir(permisos.puedeEditarPieza===true && evento.actorId===evento.versionNueva?.autorId &&
        (evento.actorId===permisos.principalVigenteId || permisos.esResponsableDePieza===true),
        'VIS280_EDICION_NO_AUTORIZADA');
      validarVersion(evento.versionNueva);
      exigir(evento.versionNueva.proyectoId===anterior.proyectoId &&
        evento.versionNueva.recursoId===anterior.recursoId &&
        evento.versionNueva.id!==anterior.id && evento.versionNueva.numero>anterior.numero &&
        evento.versionNueva.clase===anterior.clase &&
        evento.versionNueva.sha256!==anterior.sha256 &&
        evento.versionNueva.creadaEn===evento.en,
        'VIS280_CAMBIO_MATERIAL_NO_ACREDITADO');
      nuevo.version=clonar(evento.versionNueva);
      nuevo.ciclo=null; // no heredar reloj, inspección ni aceptación del documento previo
      nuevo.estado='PENDIENTE_INSPECCION';
      detalle='REQUIERE_NUEVA_INSPECCION';
      if(evento.actorId===permisos.principalVigenteId){
        // F3-ANA-183: guardar material realmente diferente + permiso concreto
        // equivale a inspeccionar esa MISMA versión creada por el principal.
        exigir(permisos.principalPuedeEditarPieza===true,'VIS280_PRINCIPAL_SIN_EDICION');
        const captura=capturarCicloVIS({configuracion,inicio:evento.en});
        nuevo.estado='EN_ESPERA';
        nuevo.ciclo={versionId:nuevo.version.id,proyectoId:nuevo.version.proyectoId,
          recursoId:nuevo.version.recursoId,estado:'EN_ESPERA',principalId:evento.actorId,
          revisadaEn:evento.en,inicio:captura.inicio,venceEn:captura.venceEn,
          duracionMinutos:captura.duracionMinutos,versionCalendario:captura.versionCalendario,
          configuracionId:captura.configuracionId,calendarioCapturado:captura.calendarioCapturado};
        detalle='CORRECCION_PROPIA_INSPECCION_INTEGRADA';
      }
      break;
    }
    case 'INVALIDACION_PRINCIPAL':{
      exigir(estado.estado==='EN_ESPERA'||estado.estado==='PAUSADA',
        'VIS280_INVALIDACION_NO_ADMITIDA');
      exigir(permisos.cambioPrincipalAcreditado===true && permisos.actorAdminVigente===true &&
        permisos.actorAdminId===evento.actorId,
        'VIS280_CAMBIO_PRINCIPAL_NO_ACREDITADO');
      nuevo.estado='PENDIENTE_INSPECCION';
      nuevo.ciclo=null;
      detalle='REINSPECCION_REQUERIDA';
      break;
    }
  }
  nuevo.revision++;
  nuevo.ultimoEventoEn=evento.en;
  // historial sin contenidos, rutas, credenciales ni detalles sensibles
  nuevo.eventos.push({revision:nuevo.revision,tipo:evento.tipo,actorId:evento.actorId,
    versionId:nuevo.version.id,en:evento.en,detalle});
  return nuevo;
}
/** Solo propone la elegibilidad; NUNCA cambia estado a PUBLICADA.
 * El posterior commit requiere leer derechos y version vigente dentro de SQL.
 */
function evaluarPreparacionVIS({estado,ahora,controles}={}){
  if(!estado||estado.estado!=='EN_ESPERA'||!estado.ciclo)
    return {elegible:false,motivo:'NO_EXISTE_CICLO_VIGENTE'};
  return evaluarCandidatoVIS({ahora,version:estado.version,ciclo:estado.ciclo,controles});
}
module.exports={crearEstadoVIS,transicionarVIS,evaluarPreparacionVIS};
