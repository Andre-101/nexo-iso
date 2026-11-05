'use strict';
/** F345: inspeccion acotada y coherente de varios trabajos de UN proyecto.
 * No muta registros, no es un worker, no activa reintentos ni revela datos de leases.
 * Una transaccion y un candado unico evitan instantaneas de proyecto inconsistentes.
 */
const {tomarCandadoPrisma330}=require('./candado-prisma-330');
const {evaluarFila344}=require('./g3-conciliacion-solo-lectura-344');
const validId=x=>Number.isSafeInteger(x)&&x>0;
function freeze(arr){return Object.freeze(arr);}
async function inspeccionarLoteIA345(db,{proyectoId,trabajoIds,ahora=new Date()}={}){
 if(!validId(proyectoId)||!Array.isArray(trabajoIds)||trabajoIds.length<1||trabajoIds.length>50||
    trabajoIds.some(id=>!validId(id))||new Set(trabajoIds).size!==trabajoIds.length||
    !(ahora instanceof Date)||!Number.isFinite(ahora.getTime())||typeof db?.$transaction!=='function')
  throw Error('IA345_PARAMETROS_INVALIDOS');
 return db.$transaction(async tx=>{
  await tomarCandadoPrisma330(tx,'PROYECTO',proyectoId);
  const registros=await tx.registroEventoIA.findMany({where:{proyectoId,id:{in:trabajoIds}},
   select:{id:true,proyectoId:true,estado:true,intentos:true,versionId:true,sha256:true,
    leaseToken:true,leaseHasta:true,tomadoEn:true,terminadoEn:true}});
  if(!Array.isArray(registros)||registros.length>trabajoIds.length||
     registros.some(r=>!r||!trabajoIds.includes(r.id)||r.proyectoId!==proyectoId)||
     new Set(registros.map(r=>r.id)).size!==registros.length)
   throw Error('IA345_LECTURA_INCONSISTENTE');
  const ids=registros.map(r=>r.id);
  const resultados=ids.length?await tx.resultadoAutomaticoIA.findMany({where:{registroId:{in:ids}},
   select:{registroId:true,proyectoId:true,versionId:true,sha256:true}}):[];
  if(!Array.isArray(resultados)||resultados.some(r=>!ids.includes(r.registroId))||
    new Set(resultados.map(r=>r.registroId)).size!==resultados.length)
   throw Error('IA345_RESULTADOS_INCONSISTENTES');
  const porId=new Map(registros.map(r=>[r.id,r]));
  const porResultado=new Map(resultados.map(r=>[r.registroId,r]));
  const revisiones=[];let consistentes=0,noVisibles=0,requierenRevision=0;
  for(const id of trabajoIds){
   const row=porId.get(id);
   if(!row){noVisibles++;revisiones.push(Object.freeze({estado:'NO_VISIBLE'}));continue;}
   // Dato inesperado: falla cerrada, nunca clasifica un estado inventado como sano.
   if(!['PENDIENTE','EN_PROCESO','LISTO','FALLIDO','CANCELADO','OMITIDO'].includes(row.estado)||
     !Number.isSafeInteger(row.intentos)||row.intentos<0)
    throw Error('IA345_ESTADO_INCOHERENTE');
   const item=evaluarFila344(row,porResultado.get(id)||null,proyectoId,ahora);
   if(item.consistente)consistentes++;else requierenRevision++;
   revisiones.push(item);
  }
  return Object.freeze({estado:'INSPECCION_LOTE_SOLO_LECTURA',proyectoId,
   totalSolicitado:trabajoIds.length,visibles:registros.length,noVisibles,
   consistentes,requierenRevision,revisiones:freeze(revisiones),
   reintentosEjecutados:0,escriturasEjecutadas:0});
 },{isolationLevel:'Serializable'});
}
module.exports={inspeccionarLoteIA345};
