'use strict';
/**
 * ALT313: protege las dos escrituras del representante sobre un diagnóstico
 * vinculado a un proyecto, sin cambiar la autoría histórica Q59.
 * Las lecturas anteriores de HTTP son solo preliminares; el permiso se vuelve
 * a calcular tras el candado ALT y con las filas de identidad bloqueadas.
 * No se admiten autorizadores o identidades derivados del body.
 *
 * Los expedientes legados sin proyecto se mantienen fuera de este adaptador:
 * su política de conservación/migración debe resolverse separadamente.
 */
const { ejecutarOperacionResguardadaALT } = require('./alt-guardia-operaciones-307');
const { ESTADO, AVISO, presentarEvaluacion } = require('../utils/resultadoOrientativo');
const ID = x => Number.isInteger(x) && x > 0 && x <= 2147483647;
const fallo = code => Object.assign(new Error(code), { code });

function datosValidos({db,proyectoId,actorId,diagnosticoId}) {
  return db && ID(proyectoId) && ID(actorId) && ID(diagnosticoId);
}

function validacionRespuestas(respuestas) {
  return Array.isArray(respuestas) && respuestas.length > 0 && respuestas.length <= 500 &&
    respuestas.every(x => ID(x?.preguntaId) && Number.isInteger(x?.valor) && x.valor >= 0 && x.valor <= 5 &&
      (x.comentario === undefined || typeof x.comentario === 'string') &&
      (x.comentario === undefined || x.comentario.length <= 3000)) &&
    new Set(respuestas.map(x => x.preguntaId)).size === respuestas.length;
}

/** Devuelve un autorizador que no acepta identidades externas ni permisos precalculados. */
function autorizador({diagnosticoId,estado}) {
  return async (tx,ctx) => {
    if (typeof tx?.$queryRaw !== 'function') throw fallo('ALT313_FUENTE_NO_ACREDITADA');
    // Proyecto -> empresa -> evaluación: orden estable para concurrencia.
    const proyectos=await tx.$queryRaw`SELECT id, "empresaId", estado FROM "ProyectoConsultoria"
      WHERE id=${ctx.proyectoId} FOR SHARE`;
    const p=proyectos?.length===1?proyectos[0]:null;
    if (!p || p.id!==ctx.proyectoId || !ID(p.empresaId) || p.estado!=='ACTIVO')
      return {autorizado:false};
    const empresas=await tx.$queryRaw`SELECT id, "usuarioId" FROM "Empresa"
      WHERE id=${p.empresaId} FOR SHARE`;
    const e=empresas?.length===1?empresas[0]:null;
    if (!e || e.id!==p.empresaId || e.usuarioId!==ctx.actorId)
      return {autorizado:false};
    const actores=await tx.$queryRaw`SELECT id, rol, activo, "bloqueoUrgente" FROM "Usuario"
      WHERE id=${ctx.actorId} FOR SHARE`;
    const u=actores?.length===1?actores[0]:null;
    if (!u || u.id!==ctx.actorId || u.rol!=='EMPRESARIO' || u.activo!==true || u.bloqueoUrgente===true)
      return {autorizado:false};
    const evaluaciones=await tx.$queryRaw`SELECT id, "proyectoId", "empresaId", estado FROM "Evaluacion"
      WHERE id=${diagnosticoId} AND "proyectoId"=${ctx.proyectoId} FOR UPDATE`;
    const d=evaluaciones?.length===1?evaluaciones[0]:null;
    if (!d || d.id!==diagnosticoId || d.proyectoId!==ctx.proyectoId ||
      d.empresaId!==p.empresaId || d.estado!==estado)
      return {autorizado:false};
    return {autorizado:true,proyectoId:ctx.proyectoId,actorId:ctx.actorId,operacion:ctx.operacion};
  };
}

async function guardarRespuestasProyectoALT({db,proyectoId,actorId,diagnosticoId,respuestas}={}) {
  if (!datosValidos({db,proyectoId,actorId,diagnosticoId}) || !validacionRespuestas(respuestas))
    throw fallo('ALT313_ENTRADA_INVALIDA');
  return ejecutarOperacionResguardadaALT({db,proyectoId,actorId,operacion:'GUARDAR_RESPUESTAS',
    autorizarOrdinariamente:autorizador({diagnosticoId,estado:'BORRADOR'}),
    ejecutar:async(tx)=>{
      if (!tx?.pregunta?.count || !tx?.respuesta?.findUnique || !tx?.respuesta?.upsert ||
        !tx?.cambioRespuestaDiagnostico?.create) throw fallo('ALT313_FUENTE_NO_ACREDITADA');
      const ids=respuestas.map(r=>r.preguntaId);
      if (await tx.pregunta.count({where:{id:{in:ids}}}) !== ids.length)
        throw fallo('ALT313_PREGUNTA_INEXISTENTE');
      let cambios=0;
      for(const r of respuestas){
        const where={evaluacionId_preguntaId:{evaluacionId:diagnosticoId,preguntaId:r.preguntaId}};
        const anterior=await tx.respuesta.findUnique({where});
        const comentarioNuevo=r.comentario?.trim()||null;
        if (anterior && anterior.valor===r.valor && (anterior.comentario||null)===comentarioNuevo) continue;
        const guardada=await tx.respuesta.upsert({where,
          update:{valor:r.valor,comentario:comentarioNuevo,actualizadaPorId:actorId},
          create:{evaluacionId:diagnosticoId,preguntaId:r.preguntaId,valor:r.valor,
            comentario:comentarioNuevo,actualizadaPorId:actorId}});
        await tx.cambioRespuestaDiagnostico.create({data:{respuestaId:guardada.id,autorId:actorId,
          valorAnterior:anterior?.valor??null,comentarioAnterior:anterior?.comentario??null,
          valorNuevo:r.valor,comentarioNuevo}});
        cambios++;
      }
      return {message:'Respuestas guardadas correctamente.',cambios};
    },
  });
}

async function enviarDiagnosticoProyectoALT({db,proyectoId,actorId,diagnosticoId}={}) {
  if (!datosValidos({db,proyectoId,actorId,diagnosticoId})) throw fallo('ALT313_ENTRADA_INVALIDA');
  return ejecutarOperacionResguardadaALT({db,proyectoId,actorId,operacion:'ENVIAR_DIAGNOSTICO',
    autorizarOrdinariamente:autorizador({diagnosticoId,estado:'BORRADOR'}),
    ejecutar:async(tx)=>{
      if (!tx?.pregunta?.count || !tx?.respuesta?.findMany || !tx?.soporte?.count ||
        !tx?.evaluacion?.update) throw fallo('ALT313_FUENTE_NO_ACREDITADA');
      const total=await tx.pregunta.count();
      if (!Number.isInteger(total) || total===0) throw fallo('ALT313_CUESTIONARIO_VACIO');
      const respuestas=await tx.respuesta.findMany({where:{evaluacionId:diagnosticoId}});
      if (respuestas.length!==total) throw fallo('ALT313_RESPUESTAS_INCOMPLETAS');
      if (respuestas.some(r=>!Number.isInteger(r.valor)||r.valor<0||r.valor>5))
        throw fallo('ALT313_RESPUESTAS_INCONSISTENTES');
      const puntajePromedio=Number((respuestas.reduce((s,r)=>s+r.valor,0)/total).toFixed(2));
      const tieneSoportes=(await tx.soporte.count({where:{evaluacionId:diagnosticoId}}))>0;
      const evaluacion=await tx.evaluacion.update({where:{id:diagnosticoId},data:{
        estado:'ENVIADA',puntajePromedio,dictamen:null,prioritaria:false,
        requiereSoportes:false,tieneSoportes,mensajeDecision:AVISO,enviadaEn:new Date(),
      }});
      return {evaluacion:presentarEvaluacion(evaluacion),decision:{
        puedeEscalar:false,estadoValidacionCriterios:ESTADO,
        mensaje:'Autodiagnostico recibido; requiere revision profesional.',
        sugerenciaIA:'Resultado estadistico orientativo. Un consultor debe revisar el SGSI y sus evidencias.',
      }};
    },
  });
}
module.exports={guardarRespuestasProyectoALT,enviarDiagnosticoProyectoALT,validacionRespuestas};
