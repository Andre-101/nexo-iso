'use strict';
/** F3-ANA-324: autorización y candados para mutaciones ordinarias de brechas.
 * El cierre formal G2 no se modifica. El guardián ALT307 adquiere 291001,
 * luego se toma 27183 y se revalidan el actor y su participación bajo SQL.
 */
const { ejecutarOperacionResguardadaALT } = require('./alt-guardia-operaciones-307');
const ID = n => Number.isInteger(n) && n > 0 && n <= 2147483647;
const fallo = code => Object.assign(new Error(code), {code});
async function ejecutarBrechaResguardadaALT({db,proyectoId,actorId,principal=false,ejecutar}={}){
 if(!db||!ID(proyectoId)||!ID(actorId)||typeof principal!=='boolean'||typeof ejecutar!=='function')
   throw fallo('ALT324_ENTRADA_INVALIDA');
 return ejecutarOperacionResguardadaALT({db,proyectoId,actorId,
   operacion:principal?'MODIFICAR_ACTIVIDAD':'CREAR_APORTE',
   autorizarOrdinariamente:async(tx,ctx)=>{
     if(typeof tx?.participacionConsultor?.findFirst!=='function')
       throw fallo('ALT324_FUENTE_NO_ACREDITADA');
     const participacion=await tx.participacionConsultor.findFirst({where:{
       proyectoId:ctx.proyectoId,usuarioId:ctx.actorId,activo:true,
       ...(principal?{principal:true}:{}),
       usuario:{activo:true,rol:'EVALUADOR',bloqueoUrgente:false},
     },select:{id:true}});
     return {...ctx,autorizado:ID(participacion?.id)};
   },
   ejecutar:async(tx,ctx)=>{
     if(typeof tx?.$queryRaw!=='function')throw fallo('ALT324_FUENTE_NO_ACREDITADA');
     // Para no usar un resultado PostgreSQL VOID directamente con Prisma.
     const candado=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${ctx.proyectoId} AS INTEGER)) IS NULL) AS "bloqueoAcuerdo"`;
     if(!Array.isArray(candado)||candado.length!==1||typeof candado[0]?.bloqueoAcuerdo!=='boolean')
       throw fallo('ALT324_CANDADO_NO_ACREDITADO');
     // Se bloquean las fuentes de vigencia para que una desactivación concurrente
     // no se interponga entre la revalidación y la mutación auditada.
     const actores=await tx.$queryRaw`SELECT id, rol, activo, "bloqueoUrgente"
       FROM "Usuario" WHERE id = ${ctx.actorId} FOR SHARE`;
     const participaciones=await tx.$queryRaw`SELECT pc.id, pc.principal, pc.activo
       FROM "ParticipacionConsultor" pc WHERE pc."proyectoId" = ${ctx.proyectoId}
       AND pc."usuarioId" = ${ctx.actorId} AND pc.activo = true FOR SHARE`;
     if(!Array.isArray(actores)||actores.length!==1||!Array.isArray(participaciones)||
        actores[0].id!==ctx.actorId||typeof actores[0].activo!=='boolean'||
        typeof actores[0].bloqueoUrgente!=='boolean'||
        participaciones.some(x=>!ID(x.id)||typeof x.activo!=='boolean'||typeof x.principal!=='boolean'))
       throw fallo('ALT324_FUENTE_NO_ACREDITADA');
     if(actores[0].rol!=='EVALUADOR'||!actores[0].activo||actores[0].bloqueoUrgente||
        !participaciones.some(x=>x.activo&&(!principal||x.principal)))
       return {status:403,message:'El consultor perdió la autorización vigente.'};
     return ejecutar(tx,ctx);
   },
 });
}
module.exports={ejecutarBrechaResguardadaALT};
