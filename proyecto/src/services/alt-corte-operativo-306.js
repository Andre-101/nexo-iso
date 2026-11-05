'use strict';
/**
 * ALT306: registro experimental DENEGATORIO de un corte formalizado por ADMIN.
 * No reabre proyectos, no modifica G2, ni constituye resolución de efectos jurídicos.
 * Los demás escritores del backend aún NO consumen este guard; no declarar corte global.
 * Se utiliza el candado VIS291/304/305 para serializar con candidaturas VIS.
 */
// El candado advisory se adquiere en la primera sentencia; todos los
// escritores ALT307 que participan de esta exclusión hacen lo mismo.
// ReadCommitted es deliberado: al salir de la espera del candado, la consulta
// y el UPDATE siguientes deben ver también las escrituras que acaban de
// confirmar las transacciones previas. Serializable conservaría una
// instantánea tomada al entrar a la espera y puede omitir esas candidaturas.
// NO usar este aislamiento como sustituto del candado, ni trasladar este
// cambio a otros servicios sin revisar sus garantías transaccionales.
const TX={isolationLevel:'ReadCommitted',maxWait:5000,timeout:10000};
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const fallo=code=>Object.assign(new Error(code),{code});
const exigir=(ok,code)=>{if(!ok)throw fallo(code);};
async function candado(tx,proyectoId){
  exigir(typeof tx.$queryRaw==='function','ALT306_BD_NO_ACREDITADA');
  const r=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
  exigir(Array.isArray(r)&&r.length===1&&typeof r[0]?.bloqueoProyecto==='boolean',
    'ALT306_CANDADO_NO_ACREDITADO');
}
/** Denegación para todos los recursos del proyecto. La ausencia NO acredita permiso positivo. */
async function consultarCorteALT(tx,proyectoId){
  exigir(ID(proyectoId)&&typeof tx?.registroCorteALT?.findUnique==='function',
    'ALT306_FUENTE_NO_ACREDITADA');
  const corte=await tx.registroCorteALT.findUnique({where:{proyectoId},
    select:{id:true,proyectoId:true,referencia:true,creadoEn:true}});
  return corte ? {restringido:true,proyectoId,corteId:corte.id} :
    {restringido:false,proyectoId,comunicacionAutorizada:false};
}
async function registrarCorteALT({db,proyectoId,adminId,referencia,justificacion,intentos=3}={}){
  exigir(typeof db?.$transaction==='function'&&ID(proyectoId)&&ID(adminId)&&
    typeof referencia==='string'&&referencia.trim().length>=8&&referencia.trim().length<=200&&
    typeof justificacion==='string'&&justificacion.trim().length>=15&&
    justificacion.trim().length<=500&&Number.isInteger(intentos)&&intentos>=1&&intentos<=4,
    'ALT306_ENTRADA_INVALIDA');
  const ref=referencia.trim(),motivo=justificacion.trim();
  for(let n=0;n<intentos;n++){
    try{return await db.$transaction(async tx=>{
      exigir(tx?.proyectoConsultoria?.findUnique&&tx?.usuario?.findUnique&&
        tx?.registroCorteALT?.findUnique&&tx?.registroCorteALT?.create&&
        tx?.eventoCorteALT?.create&&tx?.propuestaPublicacionVIS?.updateMany,
        'ALT306_BD_NO_ACREDITADA');
      await candado(tx,proyectoId);
      const [proyecto,actor]=await Promise.all([
        tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{id:true}}),
        tx.usuario.findUnique({where:{id:adminId},select:{id:true,rol:true,activo:true,bloqueoUrgente:true}})
      ]);
      exigir(proyecto?.id===proyectoId,'ALT306_PROYECTO_NO_ACREDITADO');
      exigir(actor?.id===adminId&&actor.rol==='ADMIN'&&actor.activo===true&&
        actor.bloqueoUrgente!==true,'ALT306_ADMIN_NO_AUTORIZADO');
      const anterior=await tx.registroCorteALT.findUnique({where:{proyectoId}});
      if(anterior){
        exigir(anterior.proyectoId===proyectoId,'ALT306_CORTE_INCONSISTENTE');
        if(anterior.adminId===adminId&&anterior.referencia===ref&&anterior.justificacion===motivo)
          return {resultado:'CORTE_YA_REGISTRADO',proyectoId,corteId:anterior.id};
        throw fallo('ALT306_CORTE_PREEXISTENTE');
      }
      const corte=await tx.registroCorteALT.create({data:{proyectoId,adminId,
        referencia:ref,justificacion:motivo}});
      await tx.eventoCorteALT.create({data:{corteId:corte.id,tipo:'CORTE_FORMALIZADO',
        actorId:adminId,referencia:ref}});
      // Esta sentencia se ejecuta DESPUÉS de obtener el candado por proyecto;
      // con ReadCommitted observa candidaturas confirmadas por el escritor
      // anterior, incluso si el corte empezó a esperar antes de su COMMIT.
      // No borra auditoría ni habilita ninguna versión.
      await tx.propuestaPublicacionVIS.updateMany({where:{proyectoId,
        estado:'PENDIENTE_REVALIDACION_FINAL'},data:{estado:'BLOQUEADA_POR_ALT'}});
      return {resultado:'CORTE_REGISTRADO_SIN_REACTIVACION',proyectoId,corteId:corte.id};
    },TX);}catch(e){if(e?.code==='P2034'&&n+1<intentos)continue;throw e;}
  }
  throw fallo('ALT306_CONFLICTOS_AGOTADOS');
}
module.exports={registrarCorteALT,consultarCorteALT};
