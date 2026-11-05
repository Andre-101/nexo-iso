'use strict';
/** F3-ANA-343: comparacion controlada de DOS borradores PREPARATORIOS ISO/IEC 42001.
 * No cambia estado de instrumento, no publica, no persiste ni evalua conformidad.
 * Una huella falsa, campo cambiado o identidad distinta provoca rechazo seguro.
 */
const {prepararExpediente42001}=require('./instrumento-42001-borrador-342');
const COLS=['idInterno','tituloTrabajo','fuenteId','fuenteSha256','notasPreparacion'];
const validar=exp=>{
 if(!exp||typeof exp!=='object'||!Number.isSafeInteger(exp.proyectoId)||
    exp.normaCodigo!=='ISO_42001'||exp.edicionNormativa!=='2023'||
    exp.estado!=='BORRADOR_NO_VALIDADO'||exp.puedePublicarse!==false||
    exp.puedeEjecutarDiagnostico!==false||!Array.isArray(exp.items))
  throw Error('I42001_343_EXPEDIENTE_NO_PREPARATORIO');
 const items=exp.items.map(row=>{
  if(!row||row.estado!=='BORRADOR_NO_VALIDADO'||Object.keys(row).some(k=>![...COLS,'estado'].includes(k)))
    throw Error('I42001_343_ITEM_NO_ACREDITADO');
  return Object.fromEntries(COLS.filter(k=>k!=='notasPreparacion'||row[k]!=null).map(k=>[k,row[k]]));
 });
 const canonical=prepararExpediente42001({id:exp.proyectoId,normaCodigo:'ISO_42001',edicionNormativa:'2023'},items);
 if(canonical.hashExpediente!==exp.hashExpediente || canonical.items.length!==exp.items.length)
  throw Error('I42001_343_HUELLA_ALTERADA');
 return canonical;
};
function compararBorradores42001(anterior,propuesto){
 const a=validar(anterior),b=validar(propuesto);
 if(a.proyectoId!==b.proyectoId)throw Error('I42001_343_PROYECTO_DISTINTO');
 const prev=new Map(a.items.map(row=>[row.idInterno,row]));
 const next=new Map(b.items.map(row=>[row.idInterno,row]));
 const agregados=[],retirados=[],modificados=[];
 for(const [id,row] of next){
  if(!prev.has(id))agregados.push(id);
  else{
   const diffs=COLS.filter(k=>prev.get(id)[k]!==row[k]);
   if(diffs.length)modificados.push(Object.freeze({idInterno:id,campos:Object.freeze(diffs)}));
  }
 }
 for(const id of prev.keys())if(!next.has(id))retirados.push(id);
 return Object.freeze({proyectoId:a.proyectoId,antes:a.hashExpediente,despues:b.hashExpediente,
  sinCambios:a.hashExpediente===b.hashExpediente,
  agregados:Object.freeze(agregados),retirados:Object.freeze(retirados),
  modificados:Object.freeze(modificados),estado:'REVISION_NORMATIVA_PENDIENTE',
  puedePublicarse:false,puedeEjecutarDiagnostico:false});
}
module.exports={compararBorradores42001};
