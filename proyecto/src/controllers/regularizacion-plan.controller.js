/** DEC-Q75: regularizacion excepcional respaldada por un PDF privado.
 * Solo vincula tareas capturadas como heredadas al instalar Q75. Ni la fecha
 * declarada ni la constancia prueban automaticamente la validez del acuerdo:
 * el principal asume y registra una comprobacion humana documentada.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const { idValido } = require('../utils/access');
const { autorizar } = require('../utils/proyecto-acceso');
const { uploadDir } = require('../middleware/upload.middleware');
const evidenceDir = path.join(uploadDir, 'planes-regularizacion');
fs.mkdirSync(evidenceDir, { recursive:true, mode:0o700 });
const valid=(s,a,b)=>typeof s==='string' && s.trim().length>=a && s.trim().length<=b;
const locked=async(tx,id)=>{
 const filas=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
 if(!Array.isArray(filas)||filas.length!==1||filas[0]?.bloqueoTomado!==true)
  throw Object.assign(new Error('Q75: candado comercial no acreditado'),{code:'Q75_CANDADO_INVALIDO'});
};
const conflict=e=>['P2002','P2003','P2034'].includes(e?.code);
function cleanFile(req){
 if (!req.file) return;
 const target=path.resolve(req.file.path);
 if(path.dirname(target)!==path.resolve(evidenceDir)||! /^[0-9a-f-]{36}\.pdf$/.test(path.basename(target)))return;
 try {fs.unlinkSync(target);}catch(e){if(e.code!=='ENOENT')console.error('Q75: no se pudo limpiar temporal',e);}
}
function parseIds(raw){
 try {
  const ids=JSON.parse(raw);
  return Array.isArray(ids)&&ids.length>0&&ids.length<=100&&ids.every(n=>Number.isSafeInteger(n)&&n>0)&&new Set(ids).size===ids.length?ids:null;
 }catch{return null;}
}
async function listarElegibles(req,res){
 const acceso=await autorizar(req,res,{activo:true,lider:true});if(!acceso)return;
 const records=await prisma.actividadElegibleQ75.findMany({where:{proyectoId:acceso.proyecto.id},include:{actividad:{select:{id:true,titulo:true,estado:true,planAceptadoId:true,creadaEn:true}}},orderBy:{actividadId:'asc'}});
 res.json(records.filter(x=>x.actividad && !x.actividad.planAceptadoId && ['EN_PROGRESO','EN_REVISION'].includes(x.actividad.estado))
  .map(x=>({id:x.actividadId,titulo:x.actividad.titulo,estado:x.actividad.estado,capturadaEn:x.capturadaEn,creadaEn:x.actividad.creadaEn})));
}
async function preparar(req,res,next){
 const acceso=await autorizar(req,res,{activo:true,lider:true});if(!acceso)return;
 req.q75ProjectId=acceso.proyecto.id;
 next();
}
async function registrar(req,res){
 const pid=req.q75ProjectId;
 let keepFile=false;
 try{
  if(!pid)return res.status(403).json({message:'Acceso a Q-75 no autorizado.'});
  const body=req.body||{};
  const ids=parseIds(body.actividadIds);
  const date=typeof body.fechaAceptacionHistorica==='string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.fechaAceptacionHistorica)?new Date(body.fechaAceptacionHistorica):new Date(NaN);
  if(!ids||Number.isNaN(date.valueOf())||date>new Date()||
      !valid(body.contenido,20,12000)||!valid(body.medioAceptacion,3,80)||
      !valid(body.referenciaAceptacion,3,250)||!valid(body.constanciaAceptacion,20,4000)||
      !valid(body.justificacion,20,4000)||body.confirmacionRevision!=='CONFIRMO_EVIDENCIA_REVISADA')
    return res.status(400).json({message:'Q-75: seleccione actividades heredadas e indique fecha histórica, plan, medio, referencia, constancia, justificación y confirmación de revisión documental.'});
  if(!req.file || req.file.size<10 || req.file.size>10*1024*1024 ||
      !/^[0-9a-f-]{36}\.pdf$/.test(req.file.filename))
    return res.status(400).json({message:'Adjunte un PDF de evidencia de aceptación histórica (máx. 10 MB).'});
  const pdf=fs.readFileSync(req.file.path);
  if(pdf.subarray(0,5).toString('latin1')!=='%PDF-')return res.status(400).json({message:'La evidencia adjunta no tiene firma de archivo PDF.'});
  const hash=crypto.createHash('sha256').update(pdf).digest('hex');
  const result=await prisma.$transaction(async tx=>{
   await locked(tx,pid);
   const [lider,proyecto,last,elegibles,actividades]=await Promise.all([
    tx.participacionConsultor.findFirst({where:{proyectoId:pid,usuarioId:req.usuario.id,principal:true,activo:true,usuario:{activo:true,rol:'EVALUADOR'}},select:{id:true}}),
    tx.proyectoConsultoria.findFirst({where:{id:pid,estado:'ACTIVO'},select:{id:true,creadoEn:true,empresa:{select:{usuarioId:true}}}}),
    tx.versionPlanProyecto.findFirst({where:{proyectoId:pid},orderBy:{numero:'desc'},select:{numero:true,estado:true}}),
    tx.actividadElegibleQ75.findMany({where:{proyectoId:pid,actividadId:{in:ids}},select:{actividadId:true,capturadaEn:true}}),
    tx.actividadProyecto.findMany({where:{proyectoId:pid,id:{in:ids},planAceptadoId:null,estado:{in:['EN_PROGRESO','EN_REVISION']}},
      select:{id:true,titulo:true,descripcion:true,tipoResponsable:true,asignadoAId:true,estado:true,fechaObjetivo:true,creadaEn:true,cobertura:true,acuerdoAdicionalId:true,actividadOrigenId:true,
       brechas:{where:{excluidaEn:null},select:{brechaId:true}}},orderBy:{id:'asc'}}),
   ]);
   if(!lider||!proyecto)return {status:409,message:'Proyecto o liderazgo dejó de estar activo.'};
   if(last?.estado==='PROPUESTO')return {status:409,message:'Resuelva o retire la propuesta pendiente antes de regularizar.'};
   if(elegibles.some(x=>date>=new Date(x.capturadaEn)))
    return {status:409,message:'La fecha declarada debe ser anterior al corte de instalación Q-75.'};
   if(elegibles.length!==ids.length||actividades.length!==ids.length)
    return {status:409,message:'Alguna actividad no pertenece al corte histórico Q-75, ya fue vinculada o cambió de estado.'};
   // La fecha del acuerdo no puede ser posterior a la primera modificación de ejecución
   // conocida. Si no existe registro de inicio, se conserva la declaración como histórica
   // pero se exige constancia explícita y se señala que no es verificación automatizada.
   const orden=actividades.sort((a,b)=>a.id-b.id);
   const snap=orden.map(a=>({id:a.id,titulo:a.titulo,descripcion:a.descripcion,asignadoAId:a.asignadoAId,
     tipoResponsable:a.tipoResponsable,estadoAlRegularizar:a.estado,creadaEn:a.creadaEn?new Date(a.creadaEn).toISOString():null,
     fechaObjetivo:a.fechaObjetivo?new Date(a.fechaObjetivo).toISOString():null,cobertura:a.cobertura,acuerdoAdicionalId:a.acuerdoAdicionalId,actividadOrigenId:a.actividadOrigenId,
     brechaIds:a.brechas.map(b=>b.brechaId).sort((a,b)=>a-b)}));
   const version=await tx.versionPlanProyecto.create({data:{proyectoId:pid,numero:(last?.numero??0)+1,estado:'ACEPTADO',
     contenido:body.contenido.trim(),actividadIds:orden.map(a=>a.id),instantaneaActividades:snap,
     referenciaPresentacion:`Q75 HISTÓRICO: ${body.referenciaAceptacion.trim()}`.slice(0,250),
     creadoPorId:req.usuario.id,referenciaAceptacion:body.referenciaAceptacion.trim(),
     constanciaAceptacion:body.constanciaAceptacion.trim(),aceptacionRegistradaEn:new Date()}});
   const changed=await tx.actividadProyecto.updateMany({where:{proyectoId:pid,id:{in:ids},planAceptadoId:null,
     estado:{in:['EN_PROGRESO','EN_REVISION']}},data:{planAceptadoId:version.id}});
   if(changed.count!==ids.length)throw Object.assign(new Error('Las actividades cambiaron durante la regularización'),{code:'P2034'});
   const reg=await tx.regularizacionPlanHistorico.create({data:{proyectoId:pid,versionPlanId:version.id,
     fechaAceptacionHistorica:date,medioAceptacion:body.medioAceptacion.trim(),referenciaAceptacion:body.referenciaAceptacion.trim(),
     constanciaAceptacion:body.constanciaAceptacion.trim(),justificacion:body.justificacion.trim(),
     archivoEvidencia:req.file.filename,nombreArchivo:path.basename(req.file.originalname).slice(0,180),
     sha256Evidencia:hash,tamanoBytes:req.file.size,registradoPorId:req.usuario.id}});
   await tx.eventoProyecto.create({data:{proyectoId:pid,usuarioId:req.usuario.id,accion:'PLAN_REGULARIZACION_HISTORICA_Q75',
     detalle:{regularizacionId:reg.id,versionPlanId:version.id,actividadIds:ids,
       fechaAceptacionHistorica:date.toISOString(),registradoEn:new Date().toISOString(),
       medioAceptacion:body.medioAceptacion.trim(),referenciaAceptacion:body.referenciaAceptacion.trim(),
       sha256Evidencia:hash,archivoEvidencia:req.file.filename,justificacion:body.justificacion.trim(),
       comprobacionDocumentalDeclaradaPor:req.usuario.id,aceptacionExternaNoVerificadaAutomaticamente:true}}});
   return {status:201,versionPlanId:version.id,regularizacionId:reg.id,actividadIds:ids,
    fechaAceptacionHistorica:date.toISOString(),sha256Evidencia:hash,registradoEn:new Date().toISOString(),
    aviso:'Regularización registrada con constancia y evidencia; no constituye una verificación automática del acuerdo histórico.'};
  },{isolationLevel:'Serializable'});
  if(result.status!==201)return res.status(result.status).json({message:result.message});
  keepFile=true;return res.status(201).json(result);
 }catch(e){if(conflict(e))return res.status(409).json({message:'Conflicto concurrente: vuelva a consultar las actividades elegibles.'});throw e;}
 finally{if(!keepFile)cleanFile(req);}
}
async function descargar(req,res){
 const acceso=await autorizar(req,res);if(!acceso)return;
 const id=idValido(req.params.versionId);if(!id)return res.status(400).json({message:'Versión inválida.'});
 const reg=await prisma.regularizacionPlanHistorico.findFirst({where:{versionPlanId:id,proyectoId:acceso.proyecto.id}});
 if(!reg)return res.status(404).json({message:'Sin evidencia de regularización para esta versión.'});
 if(!/^[0-9a-f-]{36}\.pdf$/.test(reg.archivoEvidencia))return res.status(409).json({message:'Ruta de evidencia inválida.'});
 const target=path.join(evidenceDir,reg.archivoEvidencia);
 if(!fs.existsSync(target))return res.status(503).json({message:'PDF de evidencia no disponible en el volumen privado.'});
 const hash=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
 if(hash!==reg.sha256Evidencia)return res.status(409).json({message:'La integridad del PDF histórico no coincide con el registro.'});
 res.set('Cache-Control','private, no-store');res.type('application/pdf');return res.sendFile(target);
}
module.exports={listarElegibles,preparar,registrar,descargar};
