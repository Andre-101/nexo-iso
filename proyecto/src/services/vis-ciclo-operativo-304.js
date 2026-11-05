'use strict';
/**
 * VIS304: ciclo de espera/pausa de una versión clasificada. Solo operación
 * interna, sin endpoint, publicación ni descarga. Los hechos de autoridad se
 * obtienen de la base bajo la MISMA transacción, no de afirmaciones del cliente.
 * El bloqueo 291001/proyectoId es compartido por VIS291/294/301/302.
 */
const {consultarFuenteAcreditadaVIS}=require('./vis-clasificacion-acreditada-300');
const TX={isolationLevel:'Serializable',maxWait:5000,timeout:10000};
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const err=code=>Object.assign(new Error(code),{code});
const exigir=(b,code)=>{if(!b)throw err(code)};
function validarBase({db,proyectoId,recursoId,actorId,intentos}){
  exigir(db&&typeof db.$transaction==='function'&&ID(proyectoId)&&ID(recursoId)&&ID(actorId)&&
    Number.isInteger(intentos)&&intentos>=1&&intentos<=4,'VIS304_ENTRADA_INVALIDA');
}
async function operacion({db,proyectoId,recursoId,actorId,intentos=3},fn){
  validarBase({db,proyectoId,recursoId,actorId,intentos});
  for(let n=0;n<intentos;n++){
    try {return await db.$transaction(async tx=>{
      exigir(typeof tx.$queryRaw==='function'&&tx.cicloOperativoVIS&&tx.eventoCicloVIS&&
        tx.usuario&&tx.participacionConsultor&&tx.proyectoConsultoria,
        'VIS304_BD_NO_ACREDITADA');
      const r=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
      exigir(Array.isArray(r)&&r.length===1&&typeof r[0]?.bloqueoProyecto==='boolean',
        'VIS304_BLOQUEO_NO_ACREDITADO');
      const [usuario,participacion,proyecto]=await Promise.all([
        tx.usuario.findUnique({where:{id:actorId},select:{id:true,rol:true,activo:true}}),
        tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:actorId,activo:true},
          select:{usuarioId:true,principal:true,activo:true}}),
        tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{id:true,estado:true}})
      ]);
      exigir(usuario?.id===actorId&&usuario.activo===true&&usuario.rol==='EVALUADOR'&&
        participacion?.usuarioId===actorId&&participacion.principal===true&&participacion.activo===true,
        'VIS304_PRINCIPAL_NO_VIGENTE');
      return fn({tx,proyecto});
    },TX);}catch(e){if(e?.code==='P2034'&&n+1<intentos)continue;throw e;}
  }
  throw err('VIS304_CONFLICTOS_AGOTADOS');
}
async function iniciarCicloVIS({db,proyectoId,recursoId,actorId,inspeccionId,directorioPrivado,intentos=3}={}){
  exigir(ID(inspeccionId)&&typeof directorioPrivado==='string'&&directorioPrivado.length>0,
    'VIS304_ENTRADA_INVALIDA');
  return operacion({db,proyectoId,recursoId,actorId,intentos},async({tx,proyecto})=>{
    exigir(proyecto?.id===proyectoId&&proyecto.estado==='ACTIVO','VIS304_PROYECTO_NO_OPERABLE');
    const fuente=await consultarFuenteAcreditadaVIS({tx,proyectoId,recursoId,directorioPrivado});
    exigir(fuente?.proyectoId===proyectoId&&fuente?.recursoId===recursoId&&
      fuente.integridadAcreditada===true&&fuente.ultimaVersionVigente===true&&
      fuente.versionIntacta===true&&ID(fuente.versionId)&&ID(fuente.numeroVersion)&&SHA(fuente.sha256),
      'VIS304_FUENTE_NO_ACREDITADA');
    const [g,inspeccion]=await Promise.all([
      tx.gobiernoRecursoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}},
        select:{comunicable:true,restringido:true,revision:true,versionClasificadaId:true,sha256Clasificada:true}}),
      tx.inspeccionPrincipalVIS.findUnique({where:{id:inspeccionId},select:{id:true,proyectoId:true,
        recursoId:true,versionId:true,numeroVersion:true,principalId:true,revisionGobierno:true,
        sha256:true,venceEn:true,inspeccionadaEn:true}})
    ]);
    exigir(g?.comunicable===true&&g.restringido===false&&
      g.versionClasificadaId===fuente.versionId&&g.sha256Clasificada===fuente.sha256&&
      ID(g.revision),'VIS304_CLASIFICACION_NO_VIGENTE');
    exigir(inspeccion?.id===inspeccionId&&inspeccion.proyectoId===proyectoId&&
      inspeccion.recursoId===recursoId&&inspeccion.versionId===fuente.versionId&&
      inspeccion.numeroVersion===fuente.numeroVersion&&inspeccion.principalId===actorId&&
      inspeccion.revisionGobierno===g.revision&&inspeccion.sha256===fuente.sha256&&
      inspeccion.inspeccionadaEn instanceof Date&&inspeccion.venceEn instanceof Date&&
      Number.isFinite(inspeccion.venceEn.getTime())&&
      inspeccion.venceEn>=inspeccion.inspeccionadaEn,'VIS304_INSPECCION_NO_ACREDITADA');
    const anterior=await tx.cicloOperativoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
    if(anterior){
      exigir(anterior.proyectoId===proyectoId&&anterior.recursoId===recursoId,
        'VIS304_ESTADO_INCONSISTENTE');
      if(anterior.inspeccionId===inspeccionId){
        exigir(anterior.estado==='EN_ESPERA'&&anterior.versionId===fuente.versionId&&
          anterior.revisionGobierno===g.revision&&anterior.sha256===fuente.sha256,
          'VIS304_CICLO_PAUSADO_O_INCONSISTENTE');
        return {resultado:'YA_INICIADO_SIN_PUBLICAR',cicloId:anterior.id,revision:anterior.revision};
      }
      exigir(anterior.estado==='PAUSADO'&&fuente.numeroVersion>anterior.numeroVersion&&
        anterior.versionId!==fuente.versionId,'VIS304_REQUIERE_NUEVA_VERSION_TRAS_PAUSA');
    }
    const revision=anterior?anterior.revision+1:1;
    const data={versionId:fuente.versionId,numeroVersion:fuente.numeroVersion,
      inspeccionId,revisionGobierno:g.revision,sha256:fuente.sha256,
      venceEn:inspeccion.venceEn,revision,estado:'EN_ESPERA'};
    let id;
    if(anterior){
      const u=await tx.cicloOperativoVIS.updateMany({where:{id:anterior.id,revision:anterior.revision,
        estado:'PAUSADO'},data});
      exigir(u.count===1,'VIS304_CONFLICTO_REVISION');id=anterior.id;
    }else {
      const creado=await tx.cicloOperativoVIS.create({data:{proyectoId,recursoId,...data}});
      id=creado.id;
    }
    await tx.eventoCicloVIS.create({data:{cicloId:id,revision,tipo:'INICIADO',actorId,
      versionId:fuente.versionId}});
    return {resultado:'INICIADO_SIN_PUBLICAR',cicloId:id,revision};
  });
}
async function pausarCicloVIS({db,proyectoId,recursoId,actorId,revisionEsperada,
  motivo,intentos=3}={}){
  exigir(Number.isInteger(revisionEsperada)&&revisionEsperada>0&&
    typeof motivo==='string'&&motivo.trim().length>=10&&motivo.trim().length<=500,
    'VIS304_ORDEN_PAUSA_INVALIDA');
  return operacion({db,proyectoId,recursoId,actorId,intentos},async({tx})=>{
    // La pausa puede aplicarse aunque el proyecto ya esté restringido.
    const ciclo=await tx.cicloOperativoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
    exigir(ciclo&&ciclo.revision===revisionEsperada,'VIS304_CONFLICTO_REVISION');
    exigir(ciclo.estado==='EN_ESPERA','VIS304_CICLO_NO_PAUSABLE');
    const u=await tx.cicloOperativoVIS.updateMany({where:{id:ciclo.id,
      revision:revisionEsperada,estado:'EN_ESPERA'},data:{estado:'PAUSADO',revision:revisionEsperada+1}});
    exigir(u.count===1,'VIS304_CONFLICTO_REVISION');
    // Una candidatura ya preparada no puede permanecer como 'pendiente' tras
    // la pausa. La invalidación y el evento PAUSADO comparten esta transacción;
    // una nueva versión tendrá que cumplir otra vez las reglas de VIS291/305.
    exigir(typeof tx.propuestaPublicacionVIS?.updateMany==='function',
      'VIS304_PROPUESTA_NO_ACREDITADA');
    await tx.propuestaPublicacionVIS.updateMany({where:{proyectoId,recursoId,
      estado:'PENDIENTE_REVALIDACION_FINAL'},data:{estado:'BLOQUEADA_POR_PAUSA'}});
    await tx.eventoCicloVIS.create({data:{cicloId:ciclo.id,revision:revisionEsperada+1,
      tipo:'PAUSADO',actorId,versionId:ciclo.versionId,motivo:motivo.trim()}});
    return {resultado:'PAUSADO_SIN_PUBLICAR',cicloId:ciclo.id,revision:revisionEsperada+1};
  });
}
module.exports={iniciarCicloVIS,pausarCicloVIS};
