/** DEC-Q65: el principal propone; ADMIN confirma contrato externo; el principal
 * registra constancia de aceptación externa del alcance. No se firman contratos. */
'use strict';
const prisma = require('../config/prisma');
const { idValido } = require('../utils/access');
const { autorizar } = require('../utils/proyecto-acceso');
const {proponerAcuerdoResguardadoALT}=require('../services/alt-acuerdos-327');
function texto(v, max, min=1) {return typeof v==='string'&&v.trim().length>=min&&v.trim().length<=max?v.trim():null;}
const conflicto = error => ['P2034','P2002','P2003'].includes(error?.code);
async function listar(req,res){
  const access=await autorizar(req,res);if(!access)return;
  if(!access.rol.admin&&!access.rol.lider)return res.status(403).json({message:'Solo ADMIN o principal vigente puede consultar acuerdos adicionales.'});
  const rows=await prisma.acuerdoAdicionalProyecto.findMany({where:{proyectoId:access.proyecto.id},orderBy:{id:'desc'}});
  return res.json(rows);
}
async function proponer(req,res){
  const access=await autorizar(req,res,{activo:true,lider:true});if(!access)return;
  const titulo=texto(req.body?.titulo,180,3),descripcion=texto(req.body?.descripcion,8000,10);
  if(!titulo||!descripcion)return res.status(400).json({message:'Se requiere título y descripción técnica del trabajo adicional.'});
  try{
    const resultado=await proponerAcuerdoResguardadoALT({db:prisma,proyectoId:access.proyecto.id,
      actorId:req.usuario.id,ejecutar:async tx=>{
        const item=await tx.acuerdoAdicionalProyecto.create({data:{
          proyectoId:access.proyecto.id,propuestoPorId:req.usuario.id,titulo,descripcion,
        }});
        await tx.eventoProyecto.create({data:{proyectoId:access.proyecto.id,usuarioId:req.usuario.id,
          accion:'ACUERDO_ADICIONAL_PROPUESTO',detalle:{acuerdoId:item.id}}});
        return {status:201,item};
      }});
    return resultado.status===201?res.status(201).json(resultado.item):
      res.status(resultado.status).json({message:resultado.message});
  }catch(e){
    if(['ALT307_CORTE_VIGENTE','ALT307_PROYECTO_NO_OPERABLE'].includes(e?.code))
      return res.status(409).json({message:'Corte ALT: no se permite proponer trabajo adicional.'});
    if(['ALT307_ACTOR_NO_VIGENTE','ALT307_PERMISO_ORDINARIO_NO_ACREDITADO'].includes(e?.code))
      return res.status(403).json({message:'El consultor principal perdió la autorización vigente.'});
    if(e?.code?.startsWith('ALT307_')||e?.code?.startsWith('ALT327_')||
        ['P2021','P2022','P1001'].includes(e?.code))
      return res.status(503).json({message:'Control ALT no disponible; no se registró el acuerdo.'});
    if(conflicto(e))return res.status(409).json({message:'Conflicto de concurrencia del acuerdo.'});
    throw e;
  }
}
async function confirmar(req,res){
  const access=await autorizar(req,res,{activo:true});if(!access)return;
  if(!access.rol.admin)return res.status(403).json({message:'La confirmación comercial corresponde exclusivamente a ADMIN.'});
  const id=idValido(req.params.acuerdoId),referencia=texto(req.body?.referenciaAcuerdo,250,3),constancia=texto(req.body?.constanciaValidacion,4000,10);
  if(!id||!referencia||!constancia)return res.status(400).json({message:'Acuerdo, referencia y constancia de validación contractual obligatorios.'});
  try {
    const result=await prisma.$transaction(async tx=>{
      const row=await tx.acuerdoAdicionalProyecto.updateMany({where:{id,proyectoId:access.proyecto.id,estado:'PROPUESTO'},data:{estado:'CONFIRMADO',referenciaAcuerdo:referencia,constanciaValidacion:constancia,confirmadoPorId:req.usuario.id,confirmadoEn:new Date()}});
      if(!row.count)return null;
      await tx.eventoProyecto.create({data:{proyectoId:access.proyecto.id,usuarioId:req.usuario.id,accion:'ACUERDO_ADICIONAL_CONFIRMADO',detalle:{acuerdoId:id,referenciaAcuerdo:referencia}}});
      return {id,estado:'CONFIRMADO'};
    },{isolationLevel:'Serializable'});
    return result?res.json(result):res.status(409).json({message:'Acuerdo no disponible, ya confirmado o modificado. Actualice el expediente.'});
  }catch(e){if(conflicto(e))return res.status(409).json({message:'Conflicto de actualización del acuerdo.'});throw e;}
}
async function registrarAceptacion(req,res){
  const access=await autorizar(req,res,{activo:true,lider:true});if(!access)return;
  const id=idValido(req.params.acuerdoId),referencia=texto(req.body?.referenciaAceptacion,250,3),constancia=texto(req.body?.constanciaAceptacion,4000,10);
  if(!id||!referencia||!constancia)return res.status(400).json({message:'Referencia de la aceptación externa del alcance y constancia verificable obligatorias.'});
  try{
    const result=await prisma.$transaction(async tx=>{
      const candado=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${access.proyecto.id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
      if(!Array.isArray(candado)||candado.length!==1||candado[0]?.bloqueoTomado!==true)
        throw Object.assign(new Error('Q65/Q66: candado comercial no acreditado'),{code:'ACUERDO_CANDADO_INVALIDO'});
      const changed=await tx.acuerdoAdicionalProyecto.updateMany({where:{id,proyectoId:access.proyecto.id,estado:'CONFIRMADO'},data:{estado:'HABILITADO',referenciaAceptacion:referencia,constanciaAceptacion:constancia,aceptacionRegistradaPorId:req.usuario.id,aceptacionRegistradaEn:new Date()}});
      if(!changed.count)return null;
      await tx.eventoProyecto.create({data:{proyectoId:access.proyecto.id,usuarioId:req.usuario.id,accion:'ALCANCE_ADICIONAL_ACEPTACION_REGISTRADA',detalle:{acuerdoId:id,referenciaAceptacion:referencia}}});
      return {id,estado:'HABILITADO'};
    },{isolationLevel:'Serializable'});
    return result?res.json(result):res.status(409).json({message:'Acuerdo no confirmado, ya habilitado o modificado.'});
  }catch(e){if(conflicto(e))return res.status(409).json({message:'Conflicto de aceptación del alcance.'});throw e;}
}
/** DEC-Q66: una modificacion formalizada retira la autorizacion del alcance
 * anterior; la ejecucion solo se reanuda con otro acuerdo habilitado y aceptado.
 * Las actividades, archivos y constancias originales NO se reescriben. */
async function registrarCambio(req,res){
  const access=await autorizar(req,res,{activo:true});if(!access)return;
  if(!access.rol.admin)return res.status(403).json({message:'Solo ADMIN registra modificaciones o cancelaciones comerciales.'});
  const id=idValido(req.params.acuerdoId);
  const tipo=req.body?.tipo;
  const estadoEsperado=req.body?.estadoEsperado;
  const referencia=texto(req.body?.referenciaCambio,250,3);
  const constancia=texto(req.body?.constanciaCambio,4000,10);
  const motivo=texto(req.body?.justificacionCambio,4000,10);
  if(!id||!['CANCELACION','MODIFICACION'].includes(tipo)||!['CONFIRMADO','HABILITADO'].includes(estadoEsperado)||!referencia||!constancia||!motivo)
    return res.status(400).json({message:'Tipo, estado vigente, referencia externa, constancia y motivo son obligatorios.'});
  const nuevoEstado=tipo==='CANCELACION'?'CANCELADO':'MODIFICADO';
  try{
    const result=await prisma.$transaction(async tx=>{
      const candado=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${access.proyecto.id} AS INTEGER)) IS NOT NULL) AS "bloqueoTomado"`;
      if(!Array.isArray(candado)||candado.length!==1||candado[0]?.bloqueoTomado!==true)
        throw Object.assign(new Error('Q65/Q66: candado comercial no acreditado'),{code:'ACUERDO_CANDADO_INVALIDO'});
      const changed=await tx.acuerdoAdicionalProyecto.updateMany({
        where:{id,proyectoId:access.proyecto.id,estado:estadoEsperado},
        data:{estado:nuevoEstado,referenciaCambio:referencia,constanciaCambio:constancia,
          justificacionCambio:motivo,resueltoPorId:req.usuario.id,resueltoEn:new Date()}
      });
      if(!changed.count)return null;
      const pendientes=await tx.actividadProyecto.count({where:{proyectoId:access.proyecto.id,
        acuerdoAdicionalId:id,estado:{notIn:['COMPLETADA','CANCELADA']}}});
      await tx.eventoProyecto.create({data:{proyectoId:access.proyecto.id,usuarioId:req.usuario.id,
        accion:tipo==='CANCELACION'?'ACUERDO_ADICIONAL_CANCELADO':'ACUERDO_ADICIONAL_MODIFICADO',
        detalle:{acuerdoId:id,desde:estadoEsperado,hasta:nuevoEstado,referenciaCambio:referencia,
          justificacionCambio:motivo,actividadesPendientesAfectadas:pendientes}}});
      return {id,estado:nuevoEstado,actividadesPendientesAfectadas:pendientes,
        aviso:'Las actividades pendientes conservan su estado e historial, pero no pueden recibir trabajo nuevo con este acuerdo.'};
    },{isolationLevel:'Serializable'});
    return result?res.json(result):res.status(409).json({message:'Acuerdo modificado por otra persona o sin habilitacion comercial vigente. Actualice el expediente.'});
  }catch(e){if(conflicto(e))return res.status(409).json({message:'Conflicto al registrar cambio comercial.'});throw e;}
}
module.exports={listar,proponer,confirmar,registrarAceptacion,registrarCambio};
