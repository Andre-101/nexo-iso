'use strict';
/** Servicio de lectura de triaje IA, con autorización revalidada DENTRO de la misma
 * transacción que inspecciona el lote. Nunca revela IDs, leases ni contenido IA.
 * Sin trabajadores, reintentos o actualizaciones automáticas.
 */
const {tomarCandadoPrisma330}=require('./candado-prisma-330');
const {evaluarFila344}=require('./g3-conciliacion-solo-lectura-344');
const {resumirInspeccionIA346}=require('./g3-resumen-revision-346');
const id=x=>Number.isSafeInteger(x)&&x>0;
const states=new Set(['PENDIENTE','EN_PROCESO','LISTO','FALLIDO','CANCELADO','OMITIDO']);
async function triajeAutorizadoIA347(db,{proyectoId,actorId,trabajoIds,ahora=new Date()}={}){
 if(!id(proyectoId)||!id(actorId)||!Array.isArray(trabajoIds)||trabajoIds.length<1||
 trabajoIds.length>50||trabajoIds.some(x=>!id(x))||new Set(trabajoIds).size!==trabajoIds.length||
 !(ahora instanceof Date)||!Number.isFinite(ahora.getTime())||typeof db?.$transaction!=='function')
   throw Object.assign(new Error('IA347_PARAMETROS_INVALIDOS'),{status:400});
 return db.$transaction(async tx=>{
  await tomarCandadoPrisma330(tx,'IDENTIDAD',actorId);
  await tomarCandadoPrisma330(tx,'CUENTA',actorId);
  await tomarCandadoPrisma330(tx,'PROYECTO',proyectoId);
  const [actor,proyecto]=await Promise.all([
   tx.usuario.findUnique({where:{id:actorId},select:{id:true,activo:true,bloqueoUrgente:true,rol:true}}),
   tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{id:true,estado:true}})
  ]);
  if(!actor?.activo||actor.bloqueoUrgente||!proyecto||proyecto.estado!=='ACTIVO')
    throw Object.assign(new Error('IA347_ACCESO_DENEGADO'),{status:403});
  if(actor.rol!=='ADMIN'){
   if(actor.rol!=='EVALUADOR'||!await tx.participacionConsultor.findFirst({
    where:{proyectoId,usuarioId:actorId,activo:true,principal:true},select:{id:true}}))
     throw Object.assign(new Error('IA347_ACCESO_DENEGADO'),{status:403});
  }
  const registros=await tx.registroEventoIA.findMany({where:{proyectoId,id:{in:trabajoIds}},select:{
   id:true,proyectoId:true,estado:true,intentos:true,versionId:true,sha256:true,
   leaseToken:true,leaseHasta:true,tomadoEn:true,terminadoEn:true}});
  if(!Array.isArray(registros)||registros.length>trabajoIds.length||
   new Set(registros.map(x=>x.id)).size!==registros.length||
   registros.some(x=>!x||x.proyectoId!==proyectoId||!trabajoIds.includes(x.id)))
    throw Error('IA347_LECTURA_INCONSISTENTE');
  const resultados=registros.length?await tx.resultadoAutomaticoIA.findMany({where:{registroId:{in:registros.map(x=>x.id)}},
   select:{registroId:true,proyectoId:true,versionId:true,sha256:true}}):[];
  if(!Array.isArray(resultados)||new Set(resultados.map(x=>x.registroId)).size!==resultados.length||
    resultados.some(x=>!registros.some(r=>r.id===x.registroId)))throw Error('IA347_RESULTADOS_INCONSISTENTES');
  const porId=new Map(registros.map(x=>[x.id,x]));
  const porResultado=new Map(resultados.map(x=>[x.registroId,x]));
  let consistentes=0,requierenRevision=0,noVisibles=0;
  const revisiones=trabajoIds.map(trabajoId=>{
   const r=porId.get(trabajoId);
   if(!r){noVisibles++;return {estado:'NO_VISIBLE'};}
   if(!states.has(r.estado)||!Number.isSafeInteger(r.intentos)||r.intentos<0)
    throw Error('IA347_ESTADO_INCOHERENTE');
   const visto=evaluarFila344(r,porResultado.get(trabajoId)||null,proyectoId,ahora);
   if(visto.consistente)consistentes++;else requierenRevision++;
   return visto;
  });
  const resumen=resumirInspeccionIA346({estado:'INSPECCION_LOTE_SOLO_LECTURA',proyectoId,
   totalSolicitado:trabajoIds.length,revisiones,visibles:registros.length,noVisibles,
   consistentes,requierenRevision,reintentosEjecutados:0,escriturasEjecutadas:0});
  return Object.freeze({...resumen,autorizacion:'ADMIN_O_PRINCIPAL_VIGENTE'});
 },{isolationLevel:'Serializable'});
}
module.exports={triajeAutorizadoIA347};
