'use strict';
/**
 * F3-ANA-301. Inspección INTENCIONAL del principal sobre pieza clasificada y PDF íntegro.
 * Es evento interno append-only y captura plazo VIS; NO equivale a aceptación
 * documental, candidatura, publicación, notificación ni autorización de descarga.
 * Invocar exclusivamente desde código servidor: nunca pasar tx o datos de permisos HTTP.
 */
const {consultarFuenteAcreditadaVIS}=require('./vis-clasificacion-acreditada-300');
const {capturarCicloVIS}=require('../utils/vis-configuracion-admin');
const TX={isolationLevel:'Serializable',maxWait:5000,timeout:10000};
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const error=code=>Object.assign(new Error(code),{code});
const exigir=(ok,code)=>{if(!ok)throw error(code)};
async function inspeccionarVersionClasificadaVIS({db,proyectoId,recursoId,actorId,
  directorioPrivado,reloj=()=>new Date(),intentos=3}={}){
  exigir(db&&typeof db.$transaction==='function'&&ID(proyectoId)&&ID(recursoId)&&ID(actorId)&&
    typeof directorioPrivado==='string'&&directorioPrivado.length>0&&
    typeof reloj==='function'&&Number.isInteger(intentos)&&intentos>=1&&intentos<=4,
    'VIS301_ENTRADA_INVALIDA');
  for(let i=0;i<intentos;i++){
    try{
      return await db.$transaction(async tx=>{
        exigir(typeof tx.$queryRaw==='function','VIS301_BD_NO_ACREDITADA');
        const bloqueo=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
        exigir(Array.isArray(bloqueo)&&bloqueo.length===1&&typeof bloqueo[0]?.bloqueoProyecto==='boolean',
          'VIS301_BLOQUEO_NO_ACREDITADO');
        const [usuario,proyecto,participacion]=await Promise.all([
          tx.usuario.findUnique({where:{id:actorId},select:{id:true,rol:true,activo:true}}),
          tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{id:true,estado:true}}),
          tx.participacionConsultor.findFirst({where:{proyectoId,usuarioId:actorId,activo:true},
            select:{id:true,usuarioId:true,principal:true,activo:true}}),
        ]);
        exigir(usuario?.id===actorId&&usuario.activo===true&&usuario.rol==='EVALUADOR'&&
          participacion?.usuarioId===actorId&&participacion.activo===true&&participacion.principal===true,
          'VIS301_PRINCIPAL_NO_VIGENTE');
        exigir(proyecto?.id===proyectoId&&proyecto.estado==='ACTIVO','VIS301_PROYECTO_NO_OPERABLE');
        const fuente=await consultarFuenteAcreditadaVIS({tx,proyectoId,recursoId,directorioPrivado});
        exigir(fuente&&fuente.proyectoId===proyectoId&&fuente.recursoId===recursoId&&
          ID(fuente.versionId)&&fuente.integridadAcreditada===true&&fuente.clasificable===true&&fuente.versionIntacta===true&&
          fuente.ultimaVersionVigente===true,'VIS301_FUENTE_NO_ACREDITADA');
        const gobierno=await tx.gobiernoRecursoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
        exigir(gobierno?.comunicable===true&&gobierno.restringido===false&&
          gobierno.versionClasificadaId===fuente.versionId&&
          gobierno.numeroVersionClasificada===fuente.numeroVersion&&
          gobierno.sha256Clasificada===fuente.sha256&&ID(gobierno.revision),
          'VIS301_CLASIFICACION_NO_VIGENTE');
        // Idempotencia solo bajo el MISMO principal y la MISMA revisión clasificada.
        // Revocaciones y cambios de versión ya fueron revalidados arriba.
        const clave={versionId:fuente.versionId,principalId:actorId,revisionGobierno:gobierno.revision};
        const anterior=await tx.inspeccionPrincipalVIS.findUnique({
          where:{versionId_principalId_revisionGobierno:clave}});
        if(anterior){
          exigir(anterior.proyectoId===proyectoId&&anterior.recursoId===recursoId&&
            anterior.sha256===fuente.sha256,'VIS301_HISTORIAL_INCONSISTENTE');
          return {resultado:'YA_INSPECCIONADA_SIN_APROBACION',inspeccionId:anterior.id,
            venceEn:anterior.venceEn};
        }
        const ahora=reloj();
        exigir(ahora instanceof Date&&Number.isFinite(ahora.getTime()),'VIS301_RELOJ_INVALIDO');
        const configuracion=await tx.configuracionVIS.findFirst({where:{estado:'ACTIVA'}});
        exigir(ID(configuracion?.id)&&configuracion.estado==='ACTIVA'&&
          configuracion.vigenteDesde instanceof Date&&Number.isFinite(configuracion.vigenteDesde.getTime())&&
          configuracion.vigenteDesde.getTime()<=ahora.getTime(),
          'VIS301_CONFIGURACION_NO_ACREDITADA');
        // Duración, festivos, franja horaria y cierres quedan capturados prospectivamente.
        const ciclo=capturarCicloVIS({configuracion,inicio:ahora.toISOString()});
        const fin=new Date(ciclo.venceEn);
        exigir(Number.isFinite(fin.getTime())&&fin.getTime()>=ahora.getTime(),
          'VIS301_VENCIMIENTO_NO_ACREDITADO');
        const creado=await tx.inspeccionPrincipalVIS.create({data:{
          proyectoId,recursoId,versionId:fuente.versionId,numeroVersion:fuente.numeroVersion,
          principalId:actorId,revisionGobierno:gobierno.revision,sha256:fuente.sha256,
          configuracionVersion:configuracion.version,duracionMinutos:ciclo.duracionMinutos,
          calendarioCapturado:ciclo.calendarioCapturado,inspeccionadaEn:ahora,venceEn:fin
        }});
        return {resultado:'INSPECCION_REGISTRADA_SIN_APROBACION',inspeccionId:creado.id,
          venceEn:creado.venceEn};
      },TX);
    }catch(e){
      if(e?.code==='P2034'&&i+1<intentos)continue;
      throw e;
    }
  }
  throw error('VIS301_CONFLICTOS_AGOTADOS');
}
module.exports={inspeccionarVersionClasificadaVIS};
