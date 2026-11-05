'use strict';
/**
 * F3-ANA-302: aceptación documental privada de la versión elaborada por otro
 * consultor. INDEPENDIENTE de revisión intencional/plazo VIS y de cualquier
 * aceptación G2. No envía comunicaciones, no publica ni autoriza descargas.
 * Solo puede invocarse desde código servidor, no aceptar clientes Prisma HTTP.
 */
const {consultarFuenteAcreditadaVIS}=require('./vis-clasificacion-acreditada-300');
const TX={isolationLevel:'Serializable',maxWait:5000,timeout:10000};
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const fallo=code=>Object.assign(new Error(code),{code});
const exigir=(ok,code)=>{if(!ok)throw fallo(code)};
async function aceptarVersionDocumentalVIS({db,proyectoId,recursoId,actorId,
  directorioPrivado,reloj=()=>new Date(),intentos=3}={}){
  exigir(db&&typeof db.$transaction==='function'&&ID(proyectoId)&&ID(recursoId)&&ID(actorId)&&
    typeof directorioPrivado==='string'&&directorioPrivado.length>0&&
    typeof reloj==='function'&&Number.isInteger(intentos)&&intentos>=1&&intentos<=4,
  'VIS302_ENTRADA_INVALIDA');
  for(let n=0;n<intentos;n++){
    try {
      return await db.$transaction(async tx=>{
        exigir(typeof tx.$queryRaw==='function'&&tx.aceptacionDocumentalVIS&&
          tx.versionPiezaComunicableVIS&&tx.usuario&&tx.proyectoConsultoria&&tx.participacionConsultor,
          'VIS302_BD_NO_ACREDITADA');
        const lock=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
        exigir(Array.isArray(lock)&&lock.length===1&&typeof lock[0]?.bloqueoProyecto==='boolean',
          'VIS302_BLOQUEO_NO_ACREDITADO');
        const actor=await tx.usuario.findUnique({where:{id:actorId},select:{id:true,rol:true,activo:true}});
        const proyecto=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{id:true,estado:true}});
        const participacion=await tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:actorId,activo:true},
          select:{usuarioId:true,principal:true,activo:true}});
        exigir(actor?.id===actorId&&actor.activo===true&&actor.rol==='EVALUADOR'&&
          participacion?.usuarioId===actorId&&participacion.activo===true&&participacion.principal===true,
          'VIS302_PRINCIPAL_NO_VIGENTE');
        exigir(proyecto?.id===proyectoId&&proyecto.estado==='ACTIVO','VIS302_PROYECTO_NO_OPERABLE');
        const fuente=await consultarFuenteAcreditadaVIS({tx,proyectoId,recursoId,directorioPrivado});
        exigir(fuente&&fuente.proyectoId===proyectoId&&fuente.recursoId===recursoId&&
          ID(fuente.versionId)&&fuente.ultimaVersionVigente===true&&fuente.versionIntacta===true&&
          fuente.integridadAcreditada===true&&fuente.origenConsultor===true,
          'VIS302_VERSION_NO_ACREDITADA');
        const version=await tx.versionPiezaComunicableVIS.findUnique({
          where:{id_proyectoId:{id:fuente.versionId,proyectoId}},
          select:{id:true,proyectoId:true,piezaId:true,creadoPorId:true,estado:true,numero:true,sha256:true}
        });
        exigir(version?.id===fuente.versionId&&version.proyectoId===proyectoId&&
          version.piezaId===recursoId&&version.estado==='BORRADOR'&&
          version.numero===fuente.numeroVersion&&version.sha256===fuente.sha256,
          'VIS302_VERSION_NO_ACREDITADA');
        // RN-13/14: quien creó la versión no puede aprobarla, ni siquiera si
        // posteriormente fue designado principal del proyecto.
        exigir(version.creadoPorId!==actorId&&fuente.responsableId!==actorId,
          'VIS302_AUTOAPROBACION_PROHIBIDA');
        const gobierno=await tx.gobiernoRecursoVIS.findUnique({
          where:{proyectoId_recursoId:{proyectoId,recursoId}},
          select:{restringido:true}
        });
        exigir(gobierno?.restringido!==true,'VIS302_RECURSO_RESTRINGIDO');
        const anterior=await tx.aceptacionDocumentalVIS.findUnique({where:{versionId:fuente.versionId}});
        if(anterior){
          exigir(anterior.proyectoId===proyectoId&&anterior.recursoId===recursoId&&
            anterior.numeroVersion===fuente.numeroVersion&&anterior.sha256===fuente.sha256,
            'VIS302_HISTORIAL_INCONSISTENTE');
          return {resultado:'YA_ACEPTADA_SIN_PUBLICAR',aceptacionId:anterior.id};
        }
        const ahora=reloj();
        exigir(ahora instanceof Date&&Number.isFinite(ahora.getTime()),'VIS302_RELOJ_INVALIDO');
        const creada=await tx.aceptacionDocumentalVIS.create({data:{proyectoId,recursoId,
          versionId:fuente.versionId,numeroVersion:fuente.numeroVersion,sha256:fuente.sha256,
          principalId:actorId,aceptadaEn:ahora}});
        return {resultado:'ACEPTADA_SIN_PUBLICAR',aceptacionId:creada.id};
      },TX);
    } catch(e) {
      if(e?.code==='P2034'&&n+1<intentos)continue;
      throw e;
    }
  }
  throw fallo('VIS302_CONFLICTOS_AGOTADOS');
}
module.exports={aceptarVersionDocumentalVIS};
