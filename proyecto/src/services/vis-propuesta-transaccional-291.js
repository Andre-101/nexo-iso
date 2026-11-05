'use strict';
/**
 * F3-ANA-291: preparar en PostgreSQL una candidatura VIS, NUNCA publicarla.
 * El revalidador es una función INTERNA (no datos del HTTP) que debe consultar
 * permisos, pertenencia, integridad documental y ciclo vigente usando `tx`.
 * No existe ruta HTTP, selección del representante, descarga ni trabajador activo.
 * Los campos de proyecto/recurso/version de los hechos se comparan siempre.
 */
const {evaluarCandidatoVIS}=require('../utils/vis-politica-publicacion');
const TX={isolationLevel:'Serializable',maxWait:5000,timeout:10000};
// IDs Prisma Int/PostgreSQL int4: evitar conversion tardia al ejecutar el candado.
const positivo=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const SHA=/^[a-f0-9]{64}$/;
const error=code=>Object.assign(new Error(code),{code});
/**
 * @param {object} db PrismaClient
 * @param {number} proyectoId Identificador existente, nunca inferido de un archivo.
 * @param {number} recursoId Identificador lógico de futura pieza comunicable.
 * @param {Function} revalidar Función PRIVADA con firma (tx) => {version,ciclo,controles}.
 */
async function prepararCandidaturaVIS({db,proyectoId,recursoId,revalidar,reloj=()=>new Date(),intentos=3}={}){
  if(!db||typeof db.$transaction!=='function'||!positivo(proyectoId)||!positivo(recursoId)||
    typeof revalidar!=='function'||!Number.isSafeInteger(intentos)||intentos<1||intentos>4)
    throw error('VIS291_ENTRADA_INVALIDA');
  for(let i=0;i<intentos;i++){
    try{
      return await db.$transaction(async tx=>{
        if(typeof tx.$queryRaw!=='function') throw error('VIS291_BD_NO_ACREDITADA');
        // pg_advisory_xact_lock devuelve SQL void, que Prisma 5.22 no deserializa.
        // Proyectar un booleano tipado, SIN alterar el alcance transaccional del candado.
        // Conservar el mismo espacio de llaves (291001, proyectoId) evita carreras.
        const bloqueo=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
        if(!Array.isArray(bloqueo)||bloqueo.length!==1||
          typeof bloqueo[0]?.bloqueoProyecto!=='boolean')
          throw error('VIS291_BLOQUEO_NO_ACREDITADO');
        const p=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{id:true,estado:true}});
        if(p?.estado!=='ACTIVO') throw error('VIS291_PROYECTO_NO_OPERABLE');
        const hechos=await revalidar(tx);
        if(!hechos||typeof hechos!=='object') throw error('VIS291_REVALIDACION_AUSENTE');
        const {version,ciclo,controles}=hechos;
        if(!version||version.proyectoId!==proyectoId||version.recursoId!==recursoId||
          !positivo(version.id)||!positivo(version.numero)||!SHA.test(version.sha256||''))
          throw error('VIS291_VERSION_AJENA_O_INTEGRA_NO_ACREDITADA');
        const t=reloj();
        if(!(t instanceof Date)||!Number.isFinite(t.getTime()))throw error('VIS291_RELOJ_INVALIDO');
        const evaluacion=evaluarCandidatoVIS({ahora:t.toISOString(),version,ciclo,controles});
        if(!evaluacion.elegible)throw error('VIS291_'+evaluacion.motivo);
        const anterior=await tx.propuestaPublicacionVIS.findUnique({where:{proyectoId_recursoId:{proyectoId,recursoId}}});
        if(anterior){
          if(anterior.versionId===version.id && anterior.numeroVersion===version.numero &&
            anterior.sha256===version.sha256 && anterior.estado==='PENDIENTE_REVALIDACION_FINAL')
            return {resultado:'YA_PREPARADA',propuestaId:anterior.id,revision:anterior.revision};
          if(version.numero<=anterior.numeroVersion)throw error('VIS291_VERSION_NO_SUPERIOR');
        }
        // Escritura y evento comparten la MISMA transacción; no hay publicación HTTP.
        const revision=anterior?anterior.revision+1:1;
        const data={versionId:version.id,numeroVersion:version.numero,sha256:version.sha256,
          revision,estado:'PENDIENTE_REVALIDACION_FINAL',elegibleEn:t,vigenteDesde:t};
        let fila;
        if(anterior){
          const upd=await tx.propuestaPublicacionVIS.updateMany({where:{id:anterior.id,
            proyectoId,recursoId,revision:anterior.revision},data});
          if(upd.count!==1)throw error('VIS291_CONFLICTO_REVISION');
          fila={id:anterior.id};
        }else{
          fila=await tx.propuestaPublicacionVIS.create({data:{proyectoId,recursoId,...data}});
        }
        await tx.eventoPropuestaVIS.create({data:{propuestaId:fila.id,revision,
          versionId:version.id,numeroVersion:version.numero,sha256:version.sha256}});
        return {resultado:'PREPARADA_SIN_PUBLICAR',propuestaId:fila.id,revision};
      },TX);
    }catch(e){
      if(e?.code==='P2034' && i+1<intentos) continue;
      throw e;
    }
  }
  throw error('VIS291_AGOTAMIENTO_CONFLICTOS');
}
module.exports={prepararCandidaturaVIS};
