'use strict';
/** Matriz de seguimiento PREPARATORIA entre borradores trazables.
 * No interpreta contenido de ISO/IEC 42001, no publica, ni permite diagnósticos.
 */
const {prepararAgendaRevision42001}=require('./instrumento-42001-impacto-345');
const VALIDOS=new Set(['AGREGADO','RETIRADO','MODIFICADO']);
function prepararMatrizSeguimiento42001(revisiones){
 const agenda=prepararAgendaRevision42001(revisiones); // verifica la cadena y las huellas
 const mapa=new Map();
 for(const paso of agenda.pasos){
  for(const cambio of paso.cambios){
   if(!VALIDOS.has(cambio.tipo)||typeof cambio.idInterno!=='string')
    throw Error('I42001_346_TIPO_INVALIDO');
   if(!mapa.has(cambio.idInterno))mapa.set(cambio.idInterno,[]);
   mapa.get(cambio.idInterno).push(Object.freeze({paso:paso.numero,tipo:cambio.tipo,
    ...(cambio.tipo==='MODIFICADO'?{campos:cambio.campos}:{})}));
  }
 }
 const elementos=Object.freeze([...mapa].sort(([a],[b])=>a.localeCompare(b,'en'))
  .map(([idInterno,eventos])=>Object.freeze({idInterno,eventos:Object.freeze(eventos)})));
 return Object.freeze({estado:'MATRIZ_PREPARATORIA_NO_APROBADA',proyectoId:agenda.proyectoId,
  primeraHuella:agenda.inicio,ultimaHuella:agenda.fin,transiciones:agenda.numeroPasos,
  identificadoresARevisar:elementos.length,elementos,
  puedePublicarse:false,puedeEjecutarDiagnostico:false,
  requiere:'REVISION_NORMATIVA_COMPETENTE_Y_APROBACION_FORMAL'});
}
module.exports={prepararMatrizSeguimiento42001};
