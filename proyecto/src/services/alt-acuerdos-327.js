'use strict';
/** ALT327: solo la propuesta de nuevo trabajo Q65 es una escritura ordinaria.
 * Las confirmaciones/cambios de contratos ya externos NO se alteran aquí:
 * su admisibilidad histórica después del corte requiere decisión diferenciada.
 * Orden: ALT291001 -> comercial27183 -> locks de vigencia -> acuerdo+evento.
 */
const {ejecutarOperacionResguardadaALT}=require('./alt-guardia-operaciones-307');
const ID=n=>Number.isInteger(n)&&n>0&&n<=2147483647;
const fallo=code=>Object.assign(new Error(code),{code});
async function proponerAcuerdoResguardadoALT({db,proyectoId,actorId,ejecutar}={}){
 if(!db||!ID(proyectoId)||!ID(actorId)||typeof ejecutar!=='function')
   throw fallo('ALT327_ENTRADA_INVALIDA');
 return ejecutarOperacionResguardadaALT({db,proyectoId,actorId,operacion:'CREAR_APORTE',
   autorizarOrdinariamente:async(tx,ctx)=>{
     if(typeof tx?.participacionConsultor?.findFirst!=='function')
       throw fallo('ALT327_FUENTE_NO_ACREDITADA');
     const p=await tx.participacionConsultor.findFirst({where:{
       proyectoId:ctx.proyectoId,usuarioId:ctx.actorId,principal:true,activo:true,
       usuario:{activo:true,rol:'EVALUADOR',bloqueoUrgente:false},
     },select:{id:true}});
     return {...ctx,autorizado:ID(p?.id)};
   },
   ejecutar:async(tx,ctx)=>{
     if(typeof tx?.$queryRaw!=='function')throw fallo('ALT327_FUENTE_NO_ACREDITADA');
     // La columna pg_advisory_xact_lock es VOID: no seleccionarla cruda con Prisma.
     const sql=await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183, CAST(${ctx.proyectoId} AS INTEGER)) IS NULL) AS "bloqueoAcuerdo"`;
     if(!Array.isArray(sql)||sql.length!==1||typeof sql[0]?.bloqueoAcuerdo!=='boolean')
       throw fallo('ALT327_CANDADO_NO_ACREDITADO');
     const actores=await tx.$queryRaw`SELECT id, rol, activo, "bloqueoUrgente" FROM "Usuario"
       WHERE id = ${ctx.actorId} FOR SHARE`;
     const participaciones=await tx.$queryRaw`SELECT pc.id, pc.principal, pc.activo FROM "ParticipacionConsultor" pc
       WHERE pc."proyectoId" = ${ctx.proyectoId} AND pc."usuarioId" = ${ctx.actorId}
       AND pc.activo = true FOR SHARE`;
     if(!Array.isArray(actores)||actores.length!==1||!Array.isArray(participaciones)||
        actores[0].id!==ctx.actorId||typeof actores[0].activo!=='boolean'||
        typeof actores[0].bloqueoUrgente!=='boolean'||
        participaciones.some(p=>!ID(p.id)||typeof p.activo!=='boolean'||typeof p.principal!=='boolean'))
       throw fallo('ALT327_FUENTE_NO_ACREDITADA');
     if(actores[0].rol!=='EVALUADOR'||!actores[0].activo||actores[0].bloqueoUrgente||
        !participaciones.some(p=>p.activo&&p.principal))
       return {status:403,message:'El consultor principal perdió la autorización vigente.'};
     return ejecutar(tx,ctx);
   },
 });
}
module.exports={proponerAcuerdoResguardadoALT};
