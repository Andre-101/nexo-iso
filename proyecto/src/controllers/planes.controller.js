/** REQ-02: versionado y constancia de aceptacion EXTERNA del plan.
 * Ningun evento implica firma ni aprobacion automatica por la plataforma.
 */
const prisma = require('../config/prisma');
const {isDeepStrictEqual} = require('node:util');
const { idValido } = require('../utils/access');
const { autorizar } = require('../utils/proyecto-acceso');
const valido = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const concurrencia = e => ['P2002','P2034','P2003'].includes(e.code);
// F3-ANA-319: Prisma 5.22 no puede deserializar columnas PostgreSQL de tipo VOID.
// La expresión IS NULL cambia el tipo SQL a boolean; su valor NO demuestra éxito
// o fracaso del candado. La sentencia termina tras adquirirlo, o lanza un error.
const lock = async (tx, id) => {
 const filas = await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${id} AS INTEGER)) IS NULL) AS "bloqueoPlan"`;
 if (!Array.isArray(filas) || filas.length !== 1 || typeof filas[0]?.bloqueoPlan !== 'boolean')
  throw Object.assign(new Error('Resultado inválido del candado comercial'),{code:'ALT319_CANDADO_NO_ACREDITADO'});
};
const evento = (tx, pid, uid, accion, detalle) => tx.eventoProyecto.create({data:{proyectoId:pid,usuarioId:uid,accion,detalle}});
const snapshotFields={id:true,titulo:true,descripcion:true,asignadoAId:true,tipoResponsable:true,
 fechaObjetivo:true,cobertura:true,acuerdoAdicionalId:true,actividadOrigenId:true,
 brechas:{where:{excluidaEn:null},select:{brechaId:true}}};
function instantanea(items){return items.map(t=>({id:t.id,titulo:t.titulo??null,descripcion:t.descripcion??null,
 asignadoAId:t.asignadoAId??null,tipoResponsable:t.tipoResponsable??null,
 fechaObjetivo:t.fechaObjetivo?new Date(t.fechaObjetivo).toISOString():null,
 cobertura:t.cobertura??null,acuerdoAdicionalId:t.acuerdoAdicionalId??null,
 actividadOrigenId:t.actividadOrigenId??null,brechaIds:(t.brechas??[]).map(b=>b.brechaId).sort((a,b)=>a-b)}));}
async function auth(req, res, write=false) {
 const acceso = await autorizar(req,res,write?{activo:true,lider:true}:{});
 return acceso;
}
async function listar(req,res){
 const acceso = await auth(req,res); if(!acceso)return;
 const versiones = await prisma.versionPlanProyecto.findMany({where:{proyectoId:acceso.proyecto.id},orderBy:{numero:'desc'},include:{regularizacionHistorica:{select:{id:true,fechaAceptacionHistorica:true,registradoEn:true,medioAceptacion:true,referenciaAceptacion:true,justificacion:true,sha256Evidencia:true,registradoPorId:true}}}});
 return res.json(versiones);
}
async function proponer(req,res){
 const acceso=await auth(req,res,true);if(!acceso)return;
 const contenido=req.body?.contenido, referencia=req.body?.referenciaPresentacion;
 if(!valido(contenido,20,12000)||!valido(referencia,3,250))
  return res.status(400).json({message:'Describa el plan (20–12000 caracteres) y la referencia de su presentación (3–250).'});
 try {
  // ALT318: el corte ALT306 comparte el primer candado con esta propuesta.
  // El candado comercial 27183 se obtiene DESPUÉS del candado por proyecto.
  // No se afirma aceptación externa ni se autoriza actuación por un JWT antiguo.
  const { ejecutarOperacionResguardadaALT } = require('../services/alt-guardia-operaciones-307');
  const result = await ejecutarOperacionResguardadaALT({
   db:prisma, proyectoId:acceso.proyecto.id, actorId:req.usuario.id, operacion:'PROPONER_PLAN',
   autorizarOrdinariamente:async(tx,ctx)=>{
    if(typeof tx.$queryRaw!=='function')throw Object.assign(new Error('Sin fuente para verificar liderazgo'),{code:'ALT318_FUENTE_NO_ACREDITADA'});
    const filas=await tx.$queryRaw`SELECT pc.id FROM "ParticipacionConsultor" pc
      JOIN "Usuario" u ON u.id = pc."usuarioId"
      WHERE pc."proyectoId" = ${ctx.proyectoId} AND pc."usuarioId" = ${ctx.actorId}
        AND pc.principal = true AND pc.activo = true AND u.activo = true
        AND u."bloqueoUrgente" = false AND u.rol = 'EVALUADOR'
      FOR SHARE OF pc, u`;
    if(!Array.isArray(filas))throw Object.assign(new Error('Consulta de liderazgo inválida'),{code:'ALT318_FUENTE_NO_ACREDITADA'});
    return filas.length===1&&Number.isInteger(filas[0]?.id)&&filas[0].id>0
      ?{autorizado:true,...ctx}:{autorizado:false};
   },
   ejecutar:async(tx,ctx)=>{
    const candado=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${ctx.proyectoId} AS INTEGER)) IS NULL) AS "bloqueoPlan"`;
    if(!Array.isArray(candado)||candado.length!==1||typeof candado[0]?.bloqueoPlan!=='boolean')
      throw Object.assign(new Error('Candado comercial no acreditado'),{code:'ALT318_CANDADO_NO_ACREDITADO'});
    // pg_advisory_xact_lock retorna VOID: el booleano NO es indicador de éxito.
    // Solo su retorno sin error demuestra que la sentencia terminó.
    const lider=await tx.participacionConsultor.findFirst({where:{proyectoId:ctx.proyectoId,usuarioId:ctx.actorId,principal:true,activo:true,usuario:{activo:true,bloqueoUrgente:false}}});
    const proyecto=await tx.proyectoConsultoria.findFirst({where:{id:ctx.proyectoId,estado:'ACTIVO'}});
    if(!lider||!proyecto)return {status:409,message:'Cambió el principal o el estado del proyecto.'};
    const anterior=await tx.versionPlanProyecto.findFirst({where:{proyectoId:ctx.proyectoId},orderBy:{numero:'desc'},include:{regularizacionHistorica:{select:{id:true,fechaAceptacionHistorica:true,registradoEn:true,medioAceptacion:true,referenciaAceptacion:true,justificacion:true,sha256Evidencia:true,registradoPorId:true}}}});
    if(anterior?.estado==='PROPUESTO')return {status:409,message:'Debe registrarse la aceptación o no aceptación de la propuesta vigente antes de versionar.'};
    // Conserva exactamente la instantánea de actividades sin autorización previa.
    const incluidas=await tx.actividadProyecto.findMany({where:{proyectoId:ctx.proyectoId,estado:'PENDIENTE',planAceptadoId:null},select:snapshotFields,orderBy:{id:'asc'}});
    const plan=await tx.versionPlanProyecto.create({data:{proyectoId:ctx.proyectoId,numero:(anterior?.numero??0)+1,
      estado:'PROPUESTO',contenido:contenido.trim(),referenciaPresentacion:referencia.trim(),
      creadoPorId:ctx.actorId,actividadIds:incluidas.map(a=>a.id),instantaneaActividades:instantanea(incluidas)}});
    await evento(tx,ctx.proyectoId,ctx.actorId,'PLAN_PROPUESTO_REQ02',{planVersionId:plan.id,numero:plan.numero,actividadIds:incluidas.map(a=>a.id),referenciaPresentacion:referencia.trim()});
    return {status:201,plan};
   },
  });
  if(result.status!==201)return res.status(result.status).json({message:result.message});
  return res.status(201).json(result.plan);
 }catch(e){
  if(concurrencia(e)||['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE'].includes(e?.code))
   return res.status(409).json({message:'El proyecto no admite nuevas propuestas de plan o hubo un conflicto.'});
  if(['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(e?.code))
   return res.status(403).json({message:'No se acredita autorización vigente para proponer el plan.'});
  if(['ALT306_FUENTE_NO_ACREDITADA','ALT307_FUENTE_NO_ACREDITADA','ALT307_CANDADO_NO_ACREDITADO',
    'ALT318_FUENTE_NO_ACREDITADA','ALT318_CANDADO_NO_ACREDITADO','ALT307_CONFLICTOS_AGOTADOS'].includes(e?.code))
   return res.status(503).json({message:'Control ALT del plan temporalmente no acreditado.'});
  throw e;
 }
}
// ALT320: autorización actualizada BAJO el candado ALT306/307. La comprobación
// previa de autorizar() solo mejora la respuesta HTTP y no sustituye esta lectura.
const { ejecutarOperacionResguardadaALT } = require('../services/alt-guardia-operaciones-307');
async function acreditarPrincipalPlan(tx,ctx){
 if(typeof tx.$queryRaw!=='function')
  throw Object.assign(new Error('Sin fuente de liderazgo'),{code:'ALT320_FUENTE_NO_ACREDITADA'});
 const filas=await tx.$queryRaw`SELECT pc.id FROM "ParticipacionConsultor" pc
   JOIN "Usuario" u ON u.id = pc."usuarioId"
   WHERE pc."proyectoId" = ${ctx.proyectoId} AND pc."usuarioId" = ${ctx.actorId}
   AND pc.principal = true AND pc.activo = true AND u.activo = true
   AND u."bloqueoUrgente" = false AND u.rol = 'EVALUADOR'
   FOR SHARE OF pc, u`;
 if(!Array.isArray(filas))
  throw Object.assign(new Error('Consulta de liderazgo inválida'),{code:'ALT320_FUENTE_NO_ACREDITADA'});
 return filas.length===1&&Number.isInteger(filas[0]?.id)&&filas[0].id>0
  ?{autorizado:true,...ctx}:{autorizado:false};
}
function responderErrorALT320(e,res,mensaje){
 if(concurrencia(e)||['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE'].includes(e?.code))
  return res.status(409).json({message:mensaje});
 if(['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(e?.code))
  return res.status(403).json({message:'Autorización vigente del principal no acreditada.'});
 if(['ALT306_FUENTE_NO_ACREDITADA','ALT307_FUENTE_NO_ACREDITADA',
     'ALT307_CANDADO_NO_ACREDITADO','ALT307_CONFLICTOS_AGOTADOS',
     'ALT319_CANDADO_NO_ACREDITADO','ALT320_FUENTE_NO_ACREDITADA'].includes(e?.code))
  return res.status(503).json({message:'Control del plan no disponible; no se registraron cambios.'});
 throw e;
}
async function resolver(req,res,aceptado){
 const acceso=await auth(req,res,true);if(!acceso)return;
 const versionId=idValido(req.params.versionId);
 const referencia=req.body?.referenciaAceptacion, constancia=req.body?.constanciaAceptacion, motivo=req.body?.motivoNoAceptacion;
 if(!versionId || (aceptado && (!valido(referencia,3,250)||!valido(constancia,10,4000))) || (!aceptado && !valido(motivo,10,4000)))
  return res.status(400).json({message:aceptado?'Se requiere referencia y constancia de aceptación externa.':'Se requiere motivo de no aceptación comunicado por la empresa.'});
 try{
  const result=await ejecutarOperacionResguardadaALT({
   db:prisma,proyectoId:acceso.proyecto.id,actorId:req.usuario.id,
   operacion:aceptado?'ACEPTAR_PLAN':'NO_ACEPTAR_PLAN',
   autorizarOrdinariamente:acreditarPrincipalPlan,
   ejecutar:async(tx,ctx)=>{
   await lock(tx,ctx.proyectoId);
   const lider=await tx.participacionConsultor.findFirst({where:{proyectoId:acceso.proyecto.id,usuarioId:req.usuario.id,principal:true,activo:true,usuario:{activo:true}}});
   const proyecto=await tx.proyectoConsultoria.findFirst({where:{id:acceso.proyecto.id,estado:'ACTIVO'}});
   if(!lider||!proyecto)return {status:409,message:'Cambió el principal o estado del proyecto.'};
   const vigente=await tx.versionPlanProyecto.findFirst({where:{proyectoId:acceso.proyecto.id},orderBy:{numero:'desc'},include:{regularizacionHistorica:{select:{id:true,fechaAceptacionHistorica:true,registradoEn:true,medioAceptacion:true,referenciaAceptacion:true,justificacion:true,sha256Evidencia:true,registradoPorId:true}}}});
   if(!vigente||vigente.id!==versionId||vigente.estado!=='PROPUESTO')return {status:409,message:'La versión no está propuesta o fue reemplazada.'};
   const ids=vigente.actividadIds;
   if(!Array.isArray(ids)||ids.some(x=>!Number.isSafeInteger(x)||x<=0)||new Set(ids).size!==ids.length)
    return {status:409,message:'Instantánea del plan inválida.'};
   if(aceptado){
    const current=await tx.actividadProyecto.findMany({where:{proyectoId:acceso.proyecto.id,id:{in:ids},
      estado:'PENDIENTE',planAceptadoId:null},select:snapshotFields,orderBy:{id:'asc'}});
    // PostgreSQL JSONB no garantiza el orden de las claves de objetos.
    // Comparar semánticamente conserva el orden de las listas y detecta cambios reales.
    if(!isDeepStrictEqual(instantanea(current),vigente.instantaneaActividades))
      return {status:409,message:'La propuesta quedó desactualizada: modificaron actividades, responsables, fechas o brechas. Retírela justificadamente y presente otra versión.'};
   }
   if(aceptado && ids.length){
    const changed=await tx.actividadProyecto.updateMany({where:{proyectoId:acceso.proyecto.id,id:{in:ids},estado:'PENDIENTE',planAceptadoId:null},data:{planAceptadoId:versionId}});
    if(changed.count!==ids.length)throw Object.assign(new Error('La propuesta ya no coincide con las actividades pendientes; registre nueva versión.'),{code:'P2034'});
   }
   const now=new Date();
   const update=await tx.versionPlanProyecto.updateMany({where:{id:versionId,proyectoId:acceso.proyecto.id,estado:'PROPUESTO'},data:aceptado?{
    estado:'ACEPTADO',referenciaAceptacion:referencia.trim(),constanciaAceptacion:constancia.trim(),aceptacionRegistradaEn:now,
   }:{estado:'NO_ACEPTADO',motivoNoAceptacion:motivo.trim(),noAceptadoEn:now}});
   if(update.count!==1)throw Object.assign(new Error('Versión cambió durante aceptación.'),{code:'P2034'});
   await evento(tx,acceso.proyecto.id,req.usuario.id,aceptado?'PLAN_ACEPTACION_EXTERNA_REGISTRADA':'PLAN_NO_ACEPTADO',{
    planVersionId:versionId,numero:vigente.numero,actividadIds:ids,
    ...(aceptado?{referenciaAceptacion:referencia.trim(),constanciaAceptacion:constancia.trim(),representanteId:acceso.proyecto.empresa.usuarioId}:{motivoNoAceptacion:motivo.trim()})});
   return {status:200,planVersionId:versionId,estado:aceptado?'ACEPTADO':'NO_ACEPTADO',actividadesIncluidas:ids.length};
  }});
  if(result.status!==200)return res.status(result.status).json({message:result.message});
  return res.json(result);
 }catch(e){return responderErrorALT320(e,res,'El plan o sus actividades cambiaron, hubo un corte ALT o conflicto concurrente.');}
}
async function retirar(req,res){
 const acceso=await auth(req,res,true);if(!acceso)return;
 const versionId=idValido(req.params.versionId), motivo=req.body?.justificacion;
 if(!versionId||!valido(motivo,10,4000))return res.status(400).json({message:'Versión y justificación obligatorias.'});
 try{
  const r=await ejecutarOperacionResguardadaALT({
   db:prisma,proyectoId:acceso.proyecto.id,actorId:req.usuario.id,
   operacion:'RETIRAR_PLAN',autorizarOrdinariamente:acreditarPrincipalPlan,
   ejecutar:async(tx,ctx)=>{
   await lock(tx,ctx.proyectoId);
   const lider=await tx.participacionConsultor.findFirst({where:{proyectoId:acceso.proyecto.id,usuarioId:req.usuario.id,principal:true,activo:true,usuario:{activo:true}}});
   const proyecto=await tx.proyectoConsultoria.findFirst({where:{id:acceso.proyecto.id,estado:'ACTIVO'}});
   if(!lider||!proyecto)return {status:409,message:'Proyecto o liderazgo no vigente.'};
   const latest=await tx.versionPlanProyecto.findFirst({where:{proyectoId:acceso.proyecto.id},orderBy:{numero:'desc'},include:{regularizacionHistorica:{select:{id:true,fechaAceptacionHistorica:true,registradoEn:true,medioAceptacion:true,referenciaAceptacion:true,justificacion:true,sha256Evidencia:true,registradoPorId:true}}}});
   if(!latest||latest.id!==versionId||latest.estado!=='PROPUESTO')return {status:409,message:'Solo la propuesta más reciente pendiente puede retirarse.'};
   const update=await tx.versionPlanProyecto.updateMany({where:{id:versionId,proyectoId:acceso.proyecto.id,estado:'PROPUESTO'},data:{estado:'RETIRADO',motivoRetiro:motivo.trim()}});
   if(update.count!==1)return {status:409,message:'La propuesta cambió.'};
   await evento(tx,acceso.proyecto.id,req.usuario.id,'PLAN_PROPUESTA_RETIRADA',{planVersionId:versionId,justificacion:motivo.trim()});
   return {status:200,estado:'RETIRADO'};
  }});
  if(r.status!==200)return res.status(r.status).json({message:r.message});return res.json(r);
 }catch(e){return responderErrorALT320(e,res,'Conflicto o corte ALT al retirar la propuesta.');}
}
module.exports={listar,proponer,aceptar:(req,res)=>resolver(req,res,true),noAceptar:(req,res)=>resolver(req,res,false),retirar};
