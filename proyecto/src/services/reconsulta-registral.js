'use strict';
const proveedor=require('./proveedor-registral-ficticio');
const {tomarCandadoPrisma330}=require('../utils/candado-prisma-330');
const {planReconsulta,huellaFuente,referenciaSuficiente}=require('../utils/registro-empresarial');
// Prisma JSON NULL difiere de SQL NULL; en integración usar explícitamente Prisma.DbNull.
function valorDbNull(proporcionado) {
  return proporcionado!==undefined ? proporcionado : require('@prisma/client').Prisma.DbNull;
}

/**
 * Una iteración de reconsulta. Aislamiento por empresa, con eventos solo en transiciones.
 * No se reintenta en bucle, no se actualiza la fuente con información del cliente.
 * El programador de intervalos es externo al proceso y debe evitar solapamientos.
 */
async function reconsultarUna(prisma,empresaId,{consultar=proveedor.consultar,dbNull}={}) {
  const anterior=await prisma.empresa.findUnique({where:{id:empresaId}});
  if(!anterior || anterior.origenDatos==='LEGADO') return {accion:'OMITIDA'};
  const respuesta=await consultar(anterior.nit);
  return prisma.$transaction(async tx=>{
    await tomarCandadoPrisma330(tx,'EMPRESA',empresaId);
    const actual=await tx.empresa.findUnique({where:{id:empresaId}});
    if(!actual || actual.origenDatos==='LEGADO') return {accion:'OMITIDA'};
    // Si cambió el NIT o la representación mientras se consultaba, descartar respuesta obsoleta.
    if(actual.nit!==anterior.nit || actual.usuarioId!==anterior.usuarioId) return {accion:'DESCARTADA_POR_CAMBIO'};
    const plan=planReconsulta(actual,respuesta);
    if(plan.accion==='ERROR') {
      await tx.empresa.update({where:{id:empresaId},data:{codigoConsulta:plan.codigo,consultadaEn:new Date()}});
      if(plan.nuevoError) await tx.eventoConsultaEmpresa.create({data:{
        empresaId,tipo:'CAMBIO_ERROR_CONSULTA_BAJA_PRIORIDAD',codigo:plan.codigo,
        destinatarioAdminId:actual.revisadaPorAdminId,prioridad:'BAJA',
      }});
      return plan;
    }
    if(plan.accion==='YA_REVISADA' || plan.accion==='FUENTE_SIN_CAMBIOS') {
      await tx.empresa.update({where:{id:empresaId},data:{codigoConsulta:'OK',consultadaEn:new Date()}});
      return plan;
    }
    if(plan.accion==='CONCILIADA') {
      await tx.eventoConsultaEmpresa.create({data:{empresaId,tipo:'CONCILIACION_AUTOMATICA',codigo:'OK',
        ...(actual.datosManual?{datosManual:actual.datosManual}:{}),referenciaManual:actual.referenciaManual}});
      await tx.empresa.update({where:{id:empresaId},data:{
        nombre:plan.fuente.nombre,sector:plan.fuente.sector,tamano:plan.fuente.tamano,
        origenDatos:'FUENTE',datosFuente:plan.fuente,datosManual:valorDbNull(dbNull),referenciaManual:null,
        codigoConsulta:'OK',consultadaEn:new Date(),revisionPendiente:false,
        bloqueoNuevosProyectos:false,huellaDecisionFuente:null,
      }});
      return plan;
    }
    if(plan.accion==='DISCREPANCIA' || plan.accion==='DISCREPANCIA_SIN_RESULTADO') {
      // No duplicar constancias al repetir una discrepancia ya abierta.
      if(!actual.bloqueoNuevosProyectos || actual.codigoConsulta!==plan.codigo ||
          (plan.fuente && huellaFuente(plan.fuente)!==huellaFuente(actual.datosFuente))) {
        await tx.eventoConsultaEmpresa.create({data:{empresaId,tipo:'DISCREPANCIA_SUSTANCIAL',
          codigo:plan.codigo,diferencias:plan.diferencias||[]}});
      }
      await tx.empresa.update({where:{id:empresaId},data:{
        codigoConsulta:plan.codigo,consultadaEn:new Date(),revisionPendiente:true,
        bloqueoNuevosProyectos:true,...(plan.fuente?{datosFuente:plan.fuente}:{})
      }});
      return plan;
    }
    throw new Error('Plan registral no soportado: '+plan.accion);
  },{isolationLevel:'Serializable'});
}

/** ADMIN escoge el valor operativo; los bytes del origen y del antecedente quedan separados. */
async function conciliar(prisma,{empresaId,adminId,eleccion,motivo,dbNull}) {
  if(!['FUENTE','ADMIN'].includes(eleccion) || !referenciaSuficiente(motivo))
    return {status:400,codigo:'DECISION_INVALIDA'};
  return prisma.$transaction(async tx=>{
    await tomarCandadoPrisma330(tx,'EMPRESA',empresaId);
    const actual=await tx.empresa.findUnique({where:{id:empresaId}});
    if(!actual) return {status:404,codigo:'NO_ENCONTRADA'};
    if(!actual.revisionPendiente || !actual.datosFuente || !actual.bloqueoNuevosProyectos)
      return {status:409,codigo:'SIN_DISCREPANCIA_RESOLUBLE'};
    if(eleccion==='ADMIN' && !actual.datosManual) return {status:409,codigo:'SIN_DATOS_ADMIN'};
    const datos=eleccion==='FUENTE'?actual.datosFuente:actual.datosManual;
    if(!datos || datos.nit!==actual.nit) return {status:409,codigo:'IDENTIDAD_NO_CONCILIABLE'};
    await tx.eventoConsultaEmpresa.create({data:{empresaId,actorAdminId:adminId,
      tipo:'CONCILIACION_DECISION_ADMIN_'+eleccion,codigo:'OK',
      diferencias:{motivo,huellaFuente:huellaFuente(actual.datosFuente)},
      ...(actual.datosManual?{datosManual:actual.datosManual}:{}),referenciaManual:actual.referenciaManual,
    }});
    await tx.empresa.update({where:{id:empresaId},data:{
      nombre:datos.nombre,sector:datos.sector,tamano:datos.tamano,
      origenDatos:eleccion==='FUENTE'?'FUENTE':'ADMIN_CONCILIADO',
      // La elección operativa NO borra ni sustituye la respuesta del proveedor.
      datosManual:eleccion==='FUENTE'?valorDbNull(dbNull):actual.datosManual,
      referenciaManual:eleccion==='FUENTE'?null:actual.referenciaManual,
      codigoConsulta:'OK',revisionPendiente:false,bloqueoNuevosProyectos:false,
      revisadaPorAdminId:adminId,huellaDecisionFuente:huellaFuente(actual.datosFuente),
    }});
    return {status:200,codigo:'CONCILIADA'};
  },{isolationLevel:'Serializable'});
}
module.exports={reconsultarUna,conciliar};
