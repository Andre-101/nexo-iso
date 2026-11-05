'use strict';
/**
 * ALT307 — Guardián experimental para operaciones ordinarias, SOLO para
 * consumidores internos que decidan integrarlo explícitamente. NO es middleware
 * global, no habilita un endpoint y no modifica operaciones G2.
 *
 * Importante: usamos ReadCommitted DELIBERADAMENTE en este guardián de corte.
 * El bloqueo advisory es la PRIMERA consulta, y la consulta de corte ocurre en
 * una sentencia posterior: así ésta obtiene una nueva instantánea después de
 * esperar a cualquier corte concurrente formalizado por ALT306. Bajo Serializable
 * la instantánea puede fijarse ANTES de esperar al candado, dando una lectura
 * antigua (un riesgo para una regla que solo consulta la tabla de cortes).
 * La exclusión con ALT306 es por proyecto y dura toda la transacción.
 *
 * Este componente NO otorga permisos ordinarios: exige un autorizador interno
 * adicional, con identidad, proyecto y operación concordantes. Nunca se debe
 * pasar una función de autorización proveniente de la solicitud HTTP.
 */
const {consultarCorteALT}=require('./alt-corte-operativo-306');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const fallo=code=>Object.assign(new Error(code),{code});
const exigir=(b,c)=>{if(!b)throw fallo(c);};
const ACCIONES=new Set(['CREAR_APORTE','PROPONER_PLAN','ACEPTAR_PLAN','NO_ACEPTAR_PLAN','RETIRAR_PLAN','MODIFICAR_ACTIVIDAD','REVISAR','APROBAR','COMPLETAR','INICIAR_DIAGNOSTICO','GUARDAR_RESPUESTAS','ENVIAR_DIAGNOSTICO']);
const TX={isolationLevel:'ReadCommitted',maxWait:5000,timeout:10000};

async function bloquearProyecto(tx,proyectoId){
  exigir(typeof tx?.$queryRaw==='function','ALT307_FUENTE_NO_ACREDITADA');
  const filas=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(291001, CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
  exigir(Array.isArray(filas)&&filas.length===1&&typeof filas[0]?.bloqueoProyecto==='boolean',
    'ALT307_CANDADO_NO_ACREDITADO');
}

/** Operación atómica interna, sin permisos positivos por ausencia de corte. */
async function ejecutarOperacionResguardadaALT({db,proyectoId,actorId,operacion,
  autorizarOrdinariamente,ejecutar,intentos=3}={}){
  exigir(typeof db?.$transaction==='function'&&ID(proyectoId)&&ID(actorId)&&
    ACCIONES.has(operacion)&&typeof autorizarOrdinariamente==='function'&&
    typeof ejecutar==='function'&&Number.isInteger(intentos)&&intentos>=1&&intentos<=4,
    'ALT307_ENTRADA_INVALIDA');
  for(let i=0;i<intentos;i++){
    try{
      return await db.$transaction(async tx=>{
        exigir(typeof tx?.proyectoConsultoria?.findUnique==='function'&&
          typeof tx?.usuario?.findUnique==='function', 'ALT307_FUENTE_NO_ACREDITADA');
        // El mismo namespace/candado empleado por ALT306 y VIS.
        await bloquearProyecto(tx,proyectoId);
        const [corte,proyecto,actor]=await Promise.all([
          consultarCorteALT(tx,proyectoId),
          tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{id:true,estado:true}}),
          tx.usuario.findUnique({where:{id:actorId},select:{id:true,activo:true,bloqueoUrgente:true,rol:true}})
        ]);
        exigir(corte?.restringido===false,'ALT307_CORTE_VIGENTE');
        exigir(proyecto?.id===proyectoId&&proyecto.estado==='ACTIVO',
          'ALT307_PROYECTO_NO_OPERABLE');
        exigir(actor?.id===actorId&&actor.activo===true&&actor.bloqueoUrgente!==true,
          'ALT307_ACTOR_NO_VIGENTE');
        // No inferir autorización por rol global, corte ausente o ADMIN.
        const permiso=await autorizarOrdinariamente(tx,{proyectoId,actorId,operacion});
        exigir(permiso?.autorizado===true&&permiso.proyectoId===proyectoId&&
          permiso.actorId===actorId&&permiso.operacion===operacion,
          'ALT307_PERMISO_ORDINARIO_NO_ACREDITADO');
        return ejecutar(tx,{proyectoId,actorId,operacion});
      },TX);
    }catch(e){if(e?.code==='P2034'&&i+1<intentos)continue;throw e;}
  }
  throw fallo('ALT307_CONFLICTOS_AGOTADOS');
}
module.exports={ejecutarOperacionResguardadaALT};
