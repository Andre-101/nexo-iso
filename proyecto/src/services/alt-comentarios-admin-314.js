'use strict';
/**
 * ALT314: mantiene la ruta administrativa de comentarios que ya existe,
 * pero coordina todas sus escrituras con el corte ALT y una sola transacción.
 * No extiende las facultades de ADMIN a otros roles ni altera G2.
 * Para evaluaciones legadas SIN proyecto continúa aplicándose el flujo histórico.
 */
const {ejecutarOperacionResguardadaALT}=require('./alt-guardia-operaciones-307');
const ID=x=>Number.isInteger(x)&&x>0&&x<=2147483647;
const fail=code=>Object.assign(new Error(code),{code});
const validar=comentarios=>Array.isArray(comentarios)&&comentarios.length>0&&comentarios.length<=100&&
  comentarios.every(x=>ID(x?.preguntaId)&&
    (x.comentarioEvaluador===undefined||x.comentarioEvaluador===null||
     (typeof x.comentarioEvaluador==='string'&&x.comentarioEvaluador.length<=3000)))&&
  new Set(comentarios.map(x=>x.preguntaId)).size===comentarios.length;

async function comentarDiagnosticoProyectoALT({db,proyectoId,actorId,diagnosticoId,comentarios}={}){
  if(!db||![proyectoId,actorId,diagnosticoId].every(ID)||!validar(comentarios))
    throw fail('ALT314_ENTRADA_INVALIDA');
  return ejecutarOperacionResguardadaALT({db,proyectoId,actorId,operacion:'REVISAR',
    autorizarOrdinariamente:async(tx,ctx)=>{
      if(typeof tx?.$queryRaw!=='function') throw fail('ALT314_FUENTE_NO_ACREDITADA');
      // Volver a comprobar la identidad real del ADMIN y pertenencia del
      // diagnóstico después de adquirir el candado del proyecto.
      const usuarios=await tx.$queryRaw`SELECT id, rol, activo, "bloqueoUrgente" FROM "Usuario"
        WHERE id=${ctx.actorId} FOR SHARE`;
      if(usuarios?.length!==1||usuarios[0].id!==ctx.actorId||usuarios[0].rol!=='ADMIN'||
         usuarios[0].activo!==true||usuarios[0].bloqueoUrgente===true) return {autorizado:false};
      const proyectos=await tx.$queryRaw`SELECT id, "empresaId", estado FROM "ProyectoConsultoria"
        WHERE id=${ctx.proyectoId} FOR SHARE`;
      const p=proyectos?.length===1?proyectos[0]:null;
      if(!p||p.id!==ctx.proyectoId||!ID(p.empresaId)||p.estado!=='ACTIVO')return {autorizado:false};
      const evaluaciones=await tx.$queryRaw`SELECT id, "proyectoId", "empresaId", estado FROM "Evaluacion"
        WHERE id=${diagnosticoId} AND "proyectoId"=${ctx.proyectoId} FOR UPDATE`;
      const e=evaluaciones?.length===1?evaluaciones[0]:null;
      if(!e||e.id!==diagnosticoId||e.proyectoId!==ctx.proyectoId||e.empresaId!==p.empresaId)
        return {autorizado:false};
      return {autorizado:true,proyectoId:ctx.proyectoId,actorId:ctx.actorId,operacion:ctx.operacion};
    },
    ejecutar:async(tx)=>{
      if(typeof tx?.respuesta?.findUnique!=='function'||typeof tx?.respuesta?.update!=='function'||
         typeof tx?.evaluacion?.update!=='function')throw fail('ALT314_FUENTE_NO_ACREDITADA');
      let cambios=0;
      for(const item of comentarios){
        const where={evaluacionId_preguntaId:{evaluacionId:diagnosticoId,preguntaId:item.preguntaId}};
        const actual=await tx.respuesta.findUnique({where});
        if(!actual)throw fail('ALT314_RESPUESTA_INEXISTENTE');
        const comentarioNuevo=(item.comentarioEvaluador||'').trim()||null;
        if((actual.comentarioEvaluador||null)===comentarioNuevo)continue;
        await tx.respuesta.update({where,data:{comentarioEvaluador:comentarioNuevo}});
        cambios++;
      }
      await tx.evaluacion.update({where:{id:diagnosticoId},data:{estado:'EN_REVISION'}});
      return {cambios};
    },
  });
}
module.exports={comentarDiagnosticoProyectoALT,validar};
