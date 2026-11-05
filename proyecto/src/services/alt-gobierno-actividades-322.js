'use strict';
/**
 * F3-ANA-322 — La designación de revisor (Q56) y el cambio de fecha (Q57)
 * comparten el mismo candado de corte ALT306 y el comercial, en una única TX.
 * En Q57 se conserva el orden empresarial 27182 -> comercial 27183, precedido
 * por el candado ALT 291001, para proteger notificaciones y representación.
 * Sin permisos por inferencia: sólo principal vigente del proyecto.
 */
const {ejecutarOperacionResguardadaALT}=require('./alt-guardia-operaciones-307');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const fallo=code=>Object.assign(new Error(code),{code});
const validar=(x,c)=>{if(!x)throw fallo(c);};
async function candado(tx,namespace,id,alias){
  validar(typeof tx?.$queryRaw==='function','ALT322_FUENTE_NO_ACREDITADA');
  // Evitar SELECT pg_advisory_xact_lock(...) sin cast: retorna VOID y Prisma
  // puede producir P2010. El booleano solo acredita forma SQL, no resultado.
  const filas=namespace===27182 ?
    await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27182, CAST(${id} AS INTEGER)) IS NULL) AS "bloqueoEmpresa"` :
    await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${id} AS INTEGER)) IS NULL) AS "bloqueoProyecto"`;
  validar(Array.isArray(filas)&&filas.length===1&&typeof filas[0]?.[alias]==='boolean',
    'ALT322_CANDADO_NO_ACREDITADO');
}
async function ejecutarGobiernoActividadALT({db,proyectoId,actorId,conBloqueoEmpresa=false,ejecutar}={}){
  validar(db&&ID(proyectoId)&&ID(actorId)&&typeof conBloqueoEmpresa==='boolean'&&typeof ejecutar==='function',
    'ALT322_ENTRADA_INVALIDA');
  return ejecutarOperacionResguardadaALT({db,proyectoId,actorId,operacion:'MODIFICAR_ACTIVIDAD',
    autorizarOrdinariamente:async(tx,ctx)=>{
      validar(typeof tx?.participacionConsultor?.findFirst==='function','ALT322_FUENTE_NO_ACREDITADA');
      const lider=await tx.participacionConsultor.findFirst({where:{
        proyectoId:ctx.proyectoId,usuarioId:ctx.actorId,principal:true,activo:true,
        usuario:{activo:true,rol:'EVALUADOR',bloqueoUrgente:false},
      },select:{id:true}});
      return {...ctx,autorizado:ID(lider?.id)};
    },
    ejecutar:async tx=>{
      if(conBloqueoEmpresa){
        validar(typeof tx?.proyectoConsultoria?.findUnique==='function','ALT322_FUENTE_NO_ACREDITADA');
        const actual=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{empresaId:true}});
        validar(ID(actual?.empresaId),'ALT322_EMPRESA_NO_ACREDITADA');
        await candado(tx,27182,actual.empresaId,'bloqueoEmpresa');
        // Verifica empresa después del candado para evitar cambios de vínculo.
        const confirma=await tx.proyectoConsultoria.findUnique({where:{id:proyectoId},select:{empresaId:true}});
        validar(confirma?.empresaId===actual.empresaId,'ALT322_EMPRESA_CAMBIO_CONCURRENTE');
      }
      await candado(tx,27183,proyectoId,'bloqueoProyecto');
      return ejecutar(tx);
    },
  });
}
module.exports={ejecutarGobiernoActividadALT};
