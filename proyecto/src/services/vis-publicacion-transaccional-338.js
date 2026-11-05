'use strict';
/**
 * VIS338: commit EXPERIMENTAL de publicación, estrictamente interno.
 * No expone rutas, no devuelve bytes/identificadores de archivo al navegador,
 * no crea prueba de entrega contractual ni autoriza producción.
 *
 * El motor debe proporcionar una reserva ALT obtenida de fuente CONFIABLE.
 * No existe implementación general de esa reserva; sin ella FALLA CERRADO.
 * Se adquiere primero el candado compartido (291001, proyectoId), usado por
 * ALT306 y la familia VIS. ReadCommitted observa el último commit al salir de
 * la espera del candado, a diferencia de un snapshot Serializable previo.
 */
const {revalidarCandidaturaAcreditadaVIS} = require('./vis-revalidacion-candidatura-305');
const {consultarCorteALT} = require('./alt-corte-operativo-306');
const {evaluarCandidatoVIS} = require('../utils/vis-politica-publicacion');
const ID = x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const SHA = x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const TX = {isolationLevel:'ReadCommitted',maxWait:5000,timeout:15000};
const fallo = codigo=>Object.assign(new Error(codigo),{code:codigo});
const exigir = (condicion,codigo)=>{if(!condicion)throw fallo(codigo);};

async function confirmarPublicacionInternaVIS338({db,proyectoId,recursoId,
  directorioPrivado,resolverReservaALT,reloj=()=>new Date(),intentos=3}={}){
  exigir(typeof db?.$transaction==='function'&&ID(proyectoId)&&ID(recursoId)&&
    typeof directorioPrivado==='string'&&directorioPrivado.length>0&&
    typeof resolverReservaALT==='function'&&typeof reloj==='function'&&
    Number.isInteger(intentos)&&intentos>=1&&intentos<=4,
    'VIS338_ENTRADA_O_RESERVA_NO_ACREDITADA');
  for(let i=0;i<intentos;i++){
    try{
      return await db.$transaction(async tx=>{
        exigir(typeof tx.$queryRaw==='function'&&
          typeof tx.propuestaPublicacionVIS?.findUnique==='function'&&
          typeof tx.propuestaPublicacionVIS?.updateMany==='function'&&
          typeof tx.publicacionConfirmadaVIS?.create==='function'&&
          typeof tx.publicacionConfirmadaVIS?.findUnique==='function'&&
          typeof tx.cicloOperativoVIS?.findUnique==='function'&&
          typeof tx.gobiernoRecursoVIS?.findUnique==='function',
          'VIS338_BD_NO_ACREDITADA');
        // SQL void no puede retornarse directamente a Prisma; solo booleano.
        const bloqueos=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NOT NULL) AS "bloqueoProyecto"`;
        exigir(Array.isArray(bloqueos)&&bloqueos.length===1&&
          typeof bloqueos[0]?.bloqueoProyecto==='boolean',
          'VIS338_CANDADO_NO_ACREDITADO');
        const ahora=reloj();
        exigir(ahora instanceof Date&&Number.isFinite(ahora.getTime()),
          'VIS338_RELOJ_NO_ACREDITADO');
        // No permitir que el callback ALT sustituya el corte persistente.
        const corte=await consultarCorteALT(tx,proyectoId);
        exigir(corte.restringido===false,'VIS338_CORTE_ALT');
        const hechos=await revalidarCandidaturaAcreditadaVIS({tx,proyectoId,recursoId,
          directorioPrivado,resolverReservaALT,ahora});
        const {version,ciclo,controles}=hechos||{};
        exigir(ID(version?.id)&&version.proyectoId===proyectoId&&
          version.recursoId===recursoId&&SHA(version.sha256)&&
          evaluarCandidatoVIS({ahora:ahora.toISOString(),version,ciclo,controles}).elegible===true,
          'VIS338_ELEGIBILIDAD_NO_ACREDITADA');
        const [propuesta,cicloActual,gobierno]=await Promise.all([
          tx.propuestaPublicacionVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}}),
          tx.cicloOperativoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}}),
          tx.gobiernoRecursoVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}})
        ]);
        exigir(ID(propuesta?.id)&&ID(propuesta.revision)&&
          propuesta.proyectoId===proyectoId&&propuesta.recursoId===recursoId&&
          propuesta.versionId===version.id&&propuesta.numeroVersion===version.numero&&
          propuesta.sha256===version.sha256&&
          ID(cicloActual?.revision)&&cicloActual.estado==='EN_ESPERA'&&
          cicloActual.versionId===version.id&&cicloActual.sha256===version.sha256&&
          ID(gobierno?.revision)&&gobierno.restringido===false&&
          gobierno.comunicable===true&&gobierno.versionClasificadaId===version.id&&
          gobierno.sha256Clasificada===version.sha256&&
          cicloActual.revisionGobierno===gobierno.revision,
          'VIS338_REVISION_O_FUENTE_NO_ACREDITADA');
        if(propuesta.estado==='PUBLICADA'){
          const previa=await tx.publicacionConfirmadaVIS.findUnique({
            where:{propuestaId_revision:{propuestaId:propuesta.id,revision:propuesta.revision}}});
          exigir(previa?.estado==='CONFIRMADA'&&previa.proyectoId===proyectoId&&
            previa.recursoId===recursoId&&previa.versionId===version.id&&
            previa.numeroVersion===version.numero&&previa.sha256===version.sha256&&
            previa.revisionGobierno===gobierno.revision&&
            previa.revisionCiclo===cicloActual.revision,
            'VIS338_PUBLICACION_HISTORICA_INCONSISTENTE');
          return Object.freeze({resultado:'YA_CONFIRMADA_SIN_ENTREGA',publicacionId:previa.id,
            propuestaId:propuesta.id,revision:propuesta.revision});
        }
        exigir(propuesta.estado==='PENDIENTE_REVALIDACION_FINAL',
          'VIS338_CANDIDATURA_NO_DISPONIBLE');
        const actualizada=await tx.propuestaPublicacionVIS.updateMany({where:{
          id:propuesta.id,proyectoId,recursoId,revision:propuesta.revision,
          versionId:version.id,sha256:version.sha256,estado:'PENDIENTE_REVALIDACION_FINAL'
        },data:{estado:'PUBLICADA'}});
        exigir(actualizada?.count===1,'VIS338_CONFLICTO_COMMIT');
        // La fila es un evento durable por revision. No hay UPDATE/DELETE
        // desde este servicio. Endurecimiento SQL append-only queda separado.
        const pub=await tx.publicacionConfirmadaVIS.create({data:{
          propuestaId:propuesta.id,revision:propuesta.revision,proyectoId,recursoId,
          versionId:version.id,numeroVersion:version.numero,sha256:version.sha256,
          revisionGobierno:gobierno.revision,revisionCiclo:cicloActual.revision,
          estado:'CONFIRMADA'
        }});
        exigir(ID(pub?.id),'VIS338_COMMIT_SIN_EVIDENCIA');
        return Object.freeze({resultado:'CONFIRMADA_INTERNA_SIN_ENTREGA',
          publicacionId:pub.id,propuestaId:propuesta.id,revision:propuesta.revision});
      },TX);
    }catch(e){
      if(e?.code==='P2034'&&i+1<intentos)continue;
      throw e;
    }
  }
  throw fallo('VIS338_CONFLICTOS_AGOTADOS');
}
module.exports={confirmarPublicacionInternaVIS338};
