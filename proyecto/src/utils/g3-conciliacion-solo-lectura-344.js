'use strict';
/** F3-ANA-344. Inspección INDIVIDUAL y sin efectos de un trabajo de revisión IA.
 * No hace reintentos, no modifica estados, no expone leases, prompts ni resultados.
 * La misma sección crítica de proyecto evita clasificar estados a medio confirmar.
 */
const {tomarCandadoPrisma330}=require('./candado-prisma-330');
const FINAL=new Set(['LISTO','FALLIDO','CANCELADO','OMITIDO']);
const STATES=new Set(['PENDIENTE','EN_PROCESO',...FINAL]);
const date=x=>x instanceof Date&&Number.isFinite(x.getTime());
const id=x=>Number.isSafeInteger(x)&&x>0;
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
function evaluarFila344(r,resultado,proyectoId,ahora){
 const problemas=[];
  const active=r.estado==='EN_PROCESO';
  if(active){
   if(r.intentos!==1||typeof r.leaseToken!=='string'||r.leaseToken.length!==36||
      !date(r.leaseHasta)||!date(r.tomadoEn)||r.terminadoEn!==null)
    problemas.push('LEASE_INCONSISTENTE');
   else if(r.leaseHasta<=ahora)problemas.push('LEASE_VENCIDO_REQUIERE_INTERVENCION');
  }else if(r.leaseToken!==null||r.leaseHasta!==null)
   problemas.push('LEASE_RESIDUAL');
  if(r.estado==='PENDIENTE'&&(r.intentos!==0||r.tomadoEn!==null||r.terminadoEn!==null))
   problemas.push('PENDIENTE_INCONSISTENTE');
  if(FINAL.has(r.estado)&&r.estado!=='OMITIDO'&&!date(r.terminadoEn))problemas.push('FIN_SIN_FECHA');
  if((r.estado==='LISTO')!==Boolean(resultado))problemas.push('RESULTADO_INCONSISTENTE');
  if(resultado&&(resultado.proyectoId!==proyectoId||resultado.versionId!==r.versionId||
    resultado.sha256!==r.sha256||!sha(r.sha256)))problemas.push('IDENTIDAD_RESULTADO_INCONSISTENTE');
  // Sin identidades personales, contenidos, detalles de documentos ni token de lease.
 return Object.freeze({estado:'INSPECCIONADO',trabajoId:r.id,proyectoId,
   situacion:r.estado,consistente:problemas.length===0,
   requiereRevision:problemas.length>0,problemas:Object.freeze(problemas)});

}
async function inspeccionarTrabajoIA344(db,{proyectoId,trabajoId,ahora=new Date()}={}){
 if(!id(proyectoId)||!id(trabajoId)||!date(ahora)||typeof db?.$transaction!=='function')
  throw Error('IA344_PARAMETROS_INVALIDOS');
 return db.$transaction(async tx=>{
  await tomarCandadoPrisma330(tx,'PROYECTO',proyectoId);
  const r=await tx.registroEventoIA.findUnique({where:{id:trabajoId},select:{
   id:true,proyectoId:true,estado:true,intentos:true,versionId:true,sha256:true,
   leaseToken:true,leaseHasta:true,tomadoEn:true,terminadoEn:true}});
  if(!r||r.proyectoId!==proyectoId)return Object.freeze({estado:'NO_VISIBLE'});
  if(!STATES.has(r.estado)||!Number.isSafeInteger(r.intentos)||r.intentos<0)
   throw Error('IA344_ESTADO_INCOHERENTE');
  const resultado=await tx.resultadoAutomaticoIA.findUnique({where:{registroId:trabajoId},
   select:{proyectoId:true,versionId:true,sha256:true}});
  return evaluarFila344(r,resultado,proyectoId,ahora);
 },{isolationLevel:'Serializable'});
}
module.exports={inspeccionarTrabajoIA344,evaluarFila344};
