'use strict';
/**
 * F3-ANA-321 — candado ALT antes del comercial para mutaciones ordinarias de
 * actividades. Sólo principal vigente y sólo proyecto operable sin corte ALT.
 * No se aplica a constancias históricas Q74 ni a G2/MCS-G2-01.
 *
 * La transacción del guardián es ReadCommitted: su lectura del corte sigue
 * al advisory lock ALT306. El candado 27183 se obtiene EN ESA MISMA
 * transacción y después del candado ALT, nunca se anida una transacción.
 */
const {ejecutarOperacionResguardadaALT} = require('./alt-guardia-operaciones-307');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const error=code=>Object.assign(new Error(code),{code});
async function ejecutarCambioActividadALT({db,proyectoId,actorId,ejecutar}={}) {
  if(!db || !ID(proyectoId) || !ID(actorId) || typeof ejecutar!=='function')
    throw error('ALT321_ENTRADA_INVALIDA');
  return ejecutarOperacionResguardadaALT({db,proyectoId,actorId,operacion:'MODIFICAR_ACTIVIDAD',
    autorizarOrdinariamente:async (tx,ctx)=>{
      if(typeof tx?.participacionConsultor?.findFirst!=='function')
        throw error('ALT321_FUENTE_NO_ACREDITADA');
      const principal=await tx.participacionConsultor.findFirst({where:{
        proyectoId:ctx.proyectoId,usuarioId:ctx.actorId,activo:true,principal:true,
        usuario:{activo:true,rol:'EVALUADOR',bloqueoUrgente:false},
      },select:{id:true}});
      return {...ctx,autorizado:ID(principal?.id)};
    },
    ejecutar:async tx=>{
      if(typeof tx?.$queryRaw!=='function')throw error('ALT321_FUENTE_NO_ACREDITADA');
      // NO comprobar el valor de este booleano: PostgreSQL retorna VOID.
      const filas=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183,
        CAST(${proyectoId} AS INTEGER)) IS NULL) AS "bloqueoComercial"`;
      if(!Array.isArray(filas)||filas.length!==1||
          typeof filas[0]?.bloqueoComercial!=='boolean')
        throw error('ALT321_CANDADO_COMERCIAL_NO_ACREDITADO');
      return ejecutar(tx);
    },
  });
}
module.exports={ejecutarCambioActividadALT};
