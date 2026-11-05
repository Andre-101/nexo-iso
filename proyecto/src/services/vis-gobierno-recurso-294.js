'use strict';
/**
 * VIS294. Gobierno documental INTERNO, experimental y sin ruta HTTP.
 * La fuente documental aún no tiene modelo canónico VIS: `revalidarFuente`
 * DEBE ser un adaptador privado, que consulte la pieza y versión bajo `tx`.
 * No aceptar esa función ni hechos de autorización del cliente HTTP.
 * La clasificación NO sustituye aprobación/revisión VIS ni publica archivos.
 * La restricción registra el mandato, pero solo la futura pasarela de
 * consulta/descarga podrá hacerlo efectivo para los representantes.
 */
const TX={isolationLevel:'Serializable',maxWait:5000,timeout:10000};
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const SHA=/^[0-9a-f]{64}$/;
const MOTIVOS=new Set(['ERROR_GRAVE','DIVULGACION_INDEBIDA']);
const error=code=>Object.assign(new Error(code),{code});
const exige=(ok,code)=>{if(!ok)throw error(code)};
function instante(reloj){
  const t=reloj();
  exige(t instanceof Date && Number.isFinite(t.getTime()),'VIS294_RELOJ_INVALIDO');
  return t;
}
async function candado(tx,proyectoId){
  exige(typeof tx.$queryRaw==='function','VIS294_BD_NO_ACREDITADA');
  // Se usa la llave VIS291 para serializar todas las escrituras de un proyecto.
  // pg_advisory_xact_lock retorna void: proyección booleana tipada para Prisma.
  const r=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
  exige(Array.isArray(r)&&r.length===1&&typeof r[0]?.bloqueoProyecto==='boolean','VIS294_BLOQUEO_NO_ACREDITADO');
}
async function actorActual(tx,actorId){
  exige(typeof tx.usuario?.findUnique==='function','VIS294_BD_NO_ACREDITADA');
  const u=await tx.usuario.findUnique({where:{id:actorId},select:{id:true,rol:true,activo:true}});
  exige(u&&u.id===actorId&&u.activo===true,'VIS294_ACTOR_INACTIVO');
  return u;
}
async function participacionVigente(tx,proyectoId,actorId){
  exige(typeof tx.participacionConsultor?.findFirst==='function','VIS294_BD_NO_ACREDITADA');
  return tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:actorId,activo:true},
    select:{id:true,usuarioId:true,principal:true,activo:true}});
}
function versionValidada(h,proyectoId,recursoId){
  exige(h&&h.proyectoId===proyectoId&&h.recursoId===recursoId&&ID(h.versionId)&&
    ID(h.numeroVersion)&&SHA.test(h.sha256||''),'VIS294_FUENTE_NO_ACREDITADA');
}
async function ejecutar({db,proyectoId,recursoId,actorId,revalidarFuente,reloj=()=>new Date(),intentos=3},fn){
  exige(db&&typeof db.$transaction==='function'&&ID(proyectoId)&&ID(recursoId)&&ID(actorId)&&
    typeof revalidarFuente==='function'&&typeof reloj==='function'&&Number.isInteger(intentos)&&
    intentos>=1&&intentos<=4,'VIS294_ENTRADA_INVALIDA');
  for(let i=0;i<intentos;i++){
    try{
      return await db.$transaction(async tx=>{
        await candado(tx,proyectoId);
        const u=await actorActual(tx,actorId);
        const proyecto=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{id:true,estado:true}});
        exige(proyecto?.id===proyectoId,'VIS294_PROYECTO_NO_EXISTE');
        const t=instante(reloj);
        const h=await revalidarFuente(tx);
        versionValidada(h,proyectoId,recursoId);
        return fn({tx,u,proyecto,t,h});
      },TX);
    }catch(e){
      if(e?.code==='P2034'&&i+1<intentos)continue;
      throw e;
    }
  }
  throw error('VIS294_CONFLICTOS_AGOTADOS');
}
/** Exclusivo del consultor responsable VIGENTE. Ningún rol global concede
 * por sí solo facultad para clasificar documentos ajenos. */
async function clasificarComunicableVIS(options={}){
  const {proyectoId,recursoId,actorId}=options;
  return ejecutar(options,async({tx,u,proyecto,t,h})=>{
    exige(proyecto.estado==='ACTIVO','VIS294_PROYECTO_NO_OPERABLE');
    exige(u.rol==='EVALUADOR','VIS294_SOLO_CONSULTOR_RESPONSABLE');
    const p=await participacionVigente(tx,proyectoId,actorId);
    exige(p?.activo===true&&p.usuarioId===actorId,'VIS294_PARTICIPACION_NO_VIGENTE');
    exige(h.responsableId===actorId&&h.origenConsultor===true&&h.versionIntacta===true&&
      h.clasificable===true&&h.ultimaVersionVigente===true,'VIS294_RESPONSABILIDAD_NO_ACREDITADA');
    const g=await tx.gobiernoRecursoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
    exige(g?.restringido!==true,'VIS294_RECURSO_RESTRINGIDO');
    if(g?.comunicable===true&&g.versionClasificadaId===h.versionId&&
      g.numeroVersionClasificada===h.numeroVersion&&g.sha256Clasificada===h.sha256){
      return {resultado:'YA_CLASIFICADA_SIN_PUBLICAR',revision:g.revision,registroId:g.id};
    }
    if(g?.comunicable===true) exige(h.numeroVersion>g.numeroVersionClasificada,'VIS294_VERSION_NO_SUPERIOR');
    const revision=(g?.revision||0)+1;
    const data={revision,comunicable:true,versionClasificadaId:h.versionId,
      numeroVersionClasificada:h.numeroVersion,sha256Clasificada:h.sha256,clasificadaPorId:actorId};
    let reg;
    if(g){
      const r=await tx.gobiernoRecursoVIS.updateMany({where:{id:g.id,revision:g.revision,restringido:false},data});
      exige(r.count===1,'VIS294_CONFLICTO_REVISION');
      reg={id:g.id};
    }else{
      reg=await tx.gobiernoRecursoVIS.create({data:{proyectoId,recursoId,...data}});
    }
    await tx.eventoGobiernoVIS.create({data:{gobiernoId:reg.id,revision,tipo:'CLASIFICADA_COMUNICABLE',
      actorId,versionId:h.versionId,numeroVersion:h.numeroVersion,creadoEn:t}});
    return {resultado:'CLASIFICADA_SIN_PUBLICAR',revision,registroId:reg.id};
  });
}
/** Restricción excepcional por ADMIN global o principal VIGENTE en el mismo
 * proyecto; autorizada incluso si el proyecto está pausado/cerrado. */
async function restringirExcepcionalVIS(options={}){
  const {proyectoId,recursoId,actorId,motivo,justificacion,revisionEsperada}=options;
  exige(MOTIVOS.has(motivo)&&typeof justificacion==='string'&&
    justificacion.trim().length>=20&&justificacion.trim().length<=1000&&
    Number.isInteger(revisionEsperada)&&revisionEsperada>=0,'VIS294_ORDEN_INVALIDA');
  return ejecutar(options,async({tx,u,t,h})=>{
    if(u.rol!=='ADMIN'){
      exige(u.rol==='EVALUADOR','VIS294_AUTORIDAD_NO_ACREDITADA');
      const p=await participacionVigente(tx,proyectoId,actorId);
      exige(p?.principal===true&&p.activo===true&&p.usuarioId===actorId,'VIS294_AUTORIDAD_NO_ACREDITADA');
    }
    exige(h.estado==='PUBLICADA'&&h.publicadaEn instanceof Date&&
      Number.isFinite(h.publicadaEn.getTime())&&h.publicadaEn.getTime()<=t.getTime()&&
      h.publicacionVigente===true&&h.integridadAcreditada===true,
      'VIS294_PUBLICACION_NO_ACREDITADA');
    const g=await tx.gobiernoRecursoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
    exige((g?.revision||0)===revisionEsperada,'VIS294_CONFLICTO_REVISION');
    exige(g?.restringido!==true,'VIS294_YA_RESTRINGIDO');
    const revision=revisionEsperada+1;
    const data={revision,restringido:true,versionRestringidaId:h.versionId,restringidaPorId:actorId,restringidaEn:t};
    let reg;
    if(g){
      const r=await tx.gobiernoRecursoVIS.updateMany({where:{id:g.id,revision:revisionEsperada,restringido:false},data});
      exige(r.count===1,'VIS294_CONFLICTO_REVISION');
      reg={id:g.id};
    }else{
      reg=await tx.gobiernoRecursoVIS.create({data:{proyectoId,recursoId,...data}});
    }
    await tx.eventoGobiernoVIS.create({data:{gobiernoId:reg.id,revision,
      tipo:'RESTRICCION_EXCEPCIONAL',actorId,versionId:h.versionId,numeroVersion:h.numeroVersion,
      motivo,justificacion:justificacion.trim(),creadoEn:t}});
    return {resultado:'RESTRICCION_REGISTRADA',revision,registroId:reg.id,
      comunicacion:'PENDIENTE_GESTION',archivoEliminado:false,descargaHTTPBloqueada:false};
  });
}
/** Sólo futuro middleware HTTP: si no hay estado acreditado, negar acceso.
 * La restricción implica negar TODAS las versiones, sin fallback. */
async function consultarEstadoParaAccesoVIS({tx,proyectoId,recursoId}={}){
  if(!tx?.gobiernoRecursoVIS||!ID(proyectoId)||!ID(recursoId))return {permitir:false,motivo:'SIN_ESTADO_ACREDITADO'};
  const g=await tx.gobiernoRecursoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
  if(!g||g.restringido!==false||g.comunicable!==true)return {permitir:false,motivo:'RESTRINGIDO_O_NO_ACREDITADO'};
  return {permitir:false,motivo:'PENDIENTE_CONTROL_VIGENCIA_Y_VIS'};
}
module.exports={clasificarComunicableVIS,restringirExcepcionalVIS,consultarEstadoParaAccesoVIS};
