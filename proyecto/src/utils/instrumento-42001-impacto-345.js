'use strict';
/** Agenda de cambios PREPARATORIA para revisión humana competente.
 * No interpreta ISO/IEC 42001, no aprueba instrumentos ni activa diagnósticos.
 * Revalida cada huella en cada comparación y no incluye contenido normativo.
 */
const {rastrearRevisiones42001}=require('./instrumento-42001-cadena-344');
const {compararBorradores42001}=require('./instrumento-42001-comparacion-343');
function prepararAgendaRevision42001(revisiones){
 const resumen=rastrearRevisiones42001(revisiones);
 const pasos=[];const ids=new Set();
 for(let n=1;n<revisiones.length;n++){
  const diff=compararBorradores42001(revisiones[n-1],revisiones[n]);
  const cambios=[];
  for(const id of diff.agregados){ids.add(id);cambios.push(Object.freeze({idInterno:id,tipo:'AGREGADO'}));}
  for(const id of diff.retirados){ids.add(id);cambios.push(Object.freeze({idInterno:id,tipo:'RETIRADO'}));}
  for(const m of diff.modificados){ids.add(m.idInterno);cambios.push(Object.freeze({idInterno:m.idInterno,tipo:'MODIFICADO',campos:m.campos}));}
  pasos.push(Object.freeze({numero:n,antes:diff.antes,despues:diff.despues,
   cambios:Object.freeze(cambios.sort((a,b)=>a.idInterno.localeCompare(b.idInterno,'en')))}));
 }
 return Object.freeze({estado:'AGENDA_REVISION_NORMATIVA_NO_APROBADA',
  proyectoId:resumen.proyectoId,inicio:resumen.inicio,fin:resumen.fin,
  numeroPasos:pasos.length,identificadoresARevisar:Object.freeze([...ids].sort()),
  pasos:Object.freeze(pasos),puedePublicarse:false,puedeEjecutarDiagnostico:false,
  requiere:'REVISION_NORMATIVA_COMPETENTE_Y_APROBACION_FORMAL'});
}
module.exports={prepararAgendaRevision42001};
