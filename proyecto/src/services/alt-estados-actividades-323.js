'use strict';
/**
 * F3-ANA-323 — Transiciones ordinarias de actividad protegidas por ALT.
 * Reutiliza exclusivamente las lecturas G2 de evidencia: NO cambia ni
 * interviene en los endpoints G2/MCS-G2-01, sus resultados o SQL.
 *
 * Secuencia: ALT 291001 -> empresa 27182 (cuando actor es representante)
 * -> comercial/equipo 27183 -> permisos y reglas actuales -> CAS y evento.
 * El guardián emplea ReadCommitted para ver un corte formalizado tras esperar.
 */
const {ejecutarOperacionResguardadaALT}=require('./alt-guardia-operaciones-307');
const {estadoDeActividad}=require('../utils/g2-evidencias');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const fallo=code=>Object.assign(new Error(code),{code});
const transiciones={PENDIENTE:['EN_PROGRESO'],EN_PROGRESO:['EN_REVISION'],
  EN_REVISION:['EN_PROGRESO','COMPLETADA'],COMPLETADA:[],CANCELADA:[]};
async function candado(tx,id,namespace,alias){
  if(typeof tx?.$queryRaw!=='function')throw fallo('ALT323_FUENTE_NO_ACREDITADA');
  // Prisma no representa el retorno VOID del pg_advisory_xact_lock.
  const filas=namespace===27182?
    await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27182, CAST(${id} AS INTEGER)) IS NULL) AS "bloqueoEmpresa"`:
    await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${id} AS INTEGER)) IS NULL) AS "bloqueoAcuerdo"`;
  if(!Array.isArray(filas)||filas.length!==1||typeof filas[0]?.[alias]!=='boolean')
    throw fallo('ALT323_CANDADO_NO_ACREDITADO');
}
async function actualizarEstadoActividadALT({db,proyectoId,actorId,actividadId,estado}={}){
  if(!db||!ID(proyectoId)||!ID(actorId)||!ID(actividadId)||typeof estado!=='string'||
     !Object.values(transiciones).some(a=>a.includes(estado)))throw fallo('ALT323_ENTRADA_INVALIDA');
  return ejecutarOperacionResguardadaALT({db,proyectoId,actorId,operacion:'MODIFICAR_ACTIVIDAD',
    autorizarOrdinariamente:async(tx,ctx)=>{
      if(typeof tx?.usuario?.findUnique!=='function'||typeof tx?.participacionConsultor?.findFirst!=='function'||
         typeof tx?.proyectoConsultoria?.findUnique!=='function'||typeof tx?.empresa?.findUnique!=='function')
        throw fallo('ALT323_FUENTE_NO_ACREDITADA');
      const actor=await tx.usuario.findUnique({where:{id:ctx.actorId},select:{rol:true}});
      if(actor?.rol==='EVALUADOR'){
        const participante=await tx.participacionConsultor.findFirst({where:{
          proyectoId:ctx.proyectoId,usuarioId:ctx.actorId,activo:true,
          usuario:{activo:true,rol:'EVALUADOR',bloqueoUrgente:false}},select:{id:true}});
        return {...ctx,autorizado:ID(participante?.id)};
      }
      if(actor?.rol==='EMPRESARIO'){
        const p=await tx.proyectoConsultoria.findUnique({where:{id:ctx.proyectoId},select:{empresaId:true}});
        const empresa=ID(p?.empresaId)?await tx.empresa.findUnique({where:{id:p.empresaId},select:{usuarioId:true}}):null;
        return {...ctx,autorizado:empresa?.usuarioId===ctx.actorId};
      }
      return {...ctx,autorizado:false};
    },
    ejecutar:async tx=>{
      if(!tx?.actividadProyecto?.findFirst||!tx?.actividadProyecto?.updateMany||
         !tx?.versionPlanProyecto?.findFirst||!tx?.eventoProyecto?.create||
         !tx?.proyectoConsultoria?.findUnique||!tx?.usuario?.findUnique)
        throw fallo('ALT323_FUENTE_NO_ACREDITADA');
      const actor=await tx.usuario.findUnique({where:{id:actorId},select:{rol:true}});
      // El representante puede cambiar durante la petición. El candado 27182
      // sincroniza la reasignación empresarial con cualquier transición.
      if(actor?.rol==='EMPRESARIO'){
        const p=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{empresaId:true}});
        if(!ID(p?.empresaId))throw fallo('ALT323_EMPRESA_NO_ACREDITADA');
        await candado(tx,p.empresaId,27182,'bloqueoEmpresa');
        const vigente=await tx.empresa.findUnique({where:{id:p.empresaId},select:{usuarioId:true}});
        if(vigente?.usuarioId!==actorId)return {status:403,message:'La representación empresarial ya no está vigente.'};
      }
      // Se exige a ambas coberturas: permite serializar cambios de equipo,
      // acuerdos comerciales y CAS de la actividad dentro de la misma TX.
      await candado(tx,proyectoId,27183,'bloqueoAcuerdo');
      // Bloqueo de fila evita que ADMIN cambie activo/bloqueoUrgente de este
      // actor durante el CAS. El guardián verificó identidad antes de tomar
      // los candados, pero aquí se valida nuevamente bajo bloqueo SQL.
      const usuarios=await tx.$queryRaw`SELECT id, rol, activo, "bloqueoUrgente"
        FROM "Usuario" WHERE id = ${actorId} FOR SHARE`;
      if(!Array.isArray(usuarios)||usuarios.length>1||
         (usuarios.length===1 && (typeof usuarios[0]?.activo!=='boolean'||
          typeof usuarios[0]?.bloqueoUrgente!=='boolean')))
        throw fallo('ALT323_USUARIO_NO_ACREDITADO');
      const usuarioActual=usuarios[0];
      if(!usuarioActual||usuarioActual.id!==actorId||usuarioActual.rol!==actor?.rol||
        !usuarioActual.activo||usuarioActual.bloqueoUrgente)
        return {status:403,message:'El actor perdió vigencia durante la transición.'};
      if(actor?.rol==='EVALUADOR'){
        const participante=await tx.participacionConsultor.findFirst({where:{
          proyectoId,usuarioId:actorId,activo:true,
          usuario:{activo:true,rol:'EVALUADOR',bloqueoUrgente:false}},select:{id:true}});
        if(!ID(participante?.id))return {status:403,message:'El consultor perdió su participación vigente.'};
      }
      const actividad=await tx.actividadProyecto.findFirst({where:{id:actividadId,proyectoId}});
      if(!actividad)return {status:404,message:'Actividad no encontrada.'};
      if(!transiciones[actividad.estado]?.includes(estado))
        return {status:409,message:'Transicion de estado invalida.'};
      if(!actividad.planAceptadoId)
        return {status:409,message:'REQ-02: la actividad no esta cubierta por una version del plan aceptada. Registre la aceptacion externa antes de ejecutar.'};
      const plan=await tx.versionPlanProyecto.findFirst({where:{
        id:actividad.planAceptadoId,proyectoId,estado:'ACEPTADO'}});
      if(!plan)return {status:409,message:'No se encontro plan vigente con aceptacion externa para esta actividad.'};
      if(actor?.rol==='EMPRESARIO'&&actividad.asignadoAId!==actorId)
        return {status:403,message:'No autorizado a modificar la actividad.'};
      if(actor?.rol==='EMPRESARIO'&&estado==='COMPLETADA')
        return {status:403,message:'Solo un consultor autorizado completa actividades.'};
      if(actividad.cobertura==='ADICIONAL'){
        if(!tx?.acuerdoAdicionalProyecto?.findFirst)throw fallo('ALT323_FUENTE_NO_ACREDITADA');
        const acuerdo=await tx.acuerdoAdicionalProyecto.findFirst({where:{
          id:actividad.acuerdoAdicionalId,proyectoId,estado:'HABILITADO'}});
        if(!acuerdo)return {status:409,message:'Acuerdo comercial o aceptación externa del alcance no habilitados.'};
      }
      if(estado==='COMPLETADA'){
        if(!tx?.entregableProyecto?.findMany||!tx?.verificacionOperativaProyecto?.findMany)
          throw fallo('ALT323_FUENTE_NO_ACREDITADA');
        const comprobacion=await estadoDeActividad(tx,proyectoId,actividadId);
        if(!comprobacion.listaParaCompletar)return {status:409,
          message:'No se puede completar: falta aceptacion documental o verificacion operativa favorable.',detalle:comprobacion};
      }
      const actualizado=await tx.actividadProyecto.updateMany({where:{
        id:actividadId,proyectoId,estado:actividad.estado,planAceptadoId:actividad.planAceptadoId,
        ...(actividad.cobertura==='ADICIONAL'?{acuerdoAdicionalId:actividad.acuerdoAdicionalId}:{})},data:{estado}});
      if(actualizado.count!==1)return {status:409,message:'Estado o autorización del acuerdo cambiaron durante la solicitud.'};
      await tx.eventoProyecto.create({data:{proyectoId,usuarioId:actorId,accion:'ACTIVIDAD_ESTADO',
        detalle:{actividadId,desde:actividad.estado,hasta:estado}}});
      return {status:200,id:actividadId,estado};
    },
  });
}
module.exports={actualizarEstadoActividadALT};
