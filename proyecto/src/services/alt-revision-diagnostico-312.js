'use strict';
/**
 * ALT312: revisión de diagnóstico por consultor activo del proyecto,
 * atómica frente al corte ALT306 y la revocación de participación.
 * No requiere liderazgo exclusivo, no modifica G2 y no admite permisos del HTTP.
 */
const { ejecutarOperacionResguardadaALT } = require('./alt-guardia-operaciones-307');
const ID = value => Number.isInteger(value) && value > 0 && value <= 2147483647;
const falla = code => Object.assign(new Error(code), { code });

async function revisarDiagnosticoResguardadoALT({ db, proyectoId, actorId, diagnosticoId, comentarios } = {}) {
  if (!db || !ID(proyectoId) || !ID(actorId) || !ID(diagnosticoId) ||
      !Array.isArray(comentarios) || !comentarios.length || comentarios.length > 100 ||
      comentarios.some(c => !ID(c?.preguntaId) || typeof c.comentario !== 'string' ||
        !c.comentario.trim() || c.comentario.length > 3000) ||
      new Set(comentarios.map(c => c.preguntaId)).size !== comentarios.length)
    throw falla('ALT312_ENTRADA_INVALIDA');
  const items = comentarios.map(c => ({ preguntaId: c.preguntaId, comentario: c.comentario.trim() }));
  return ejecutarOperacionResguardadaALT({
    db, proyectoId, actorId, operacion: 'REVISAR',
    autorizarOrdinariamente: async (tx, ctx) => {
      if (!tx?.$queryRaw || !tx?.respuesta?.updateMany || !tx?.evaluacion?.updateMany ||
          !tx?.eventoProyecto?.create) throw falla('ALT312_FUENTE_NO_ACREDITADA');
      // Orden fijo: candado ALT -> proyecto -> participación y usuario -> evaluación.
      // FOR SHARE mantiene vigentes las credenciales y la asignación mientras se escribe.
      const proyectos = await tx.$queryRaw`SELECT id, estado FROM "ProyectoConsultoria"
        WHERE id = ${ctx.proyectoId} FOR SHARE`;
      if (proyectos?.length !== 1 || proyectos[0].id !== ctx.proyectoId || proyectos[0].estado !== 'ACTIVO')
        return { autorizado: false };
      const participaciones = await tx.$queryRaw`SELECT pc.id FROM "ParticipacionConsultor" pc
        JOIN "Usuario" u ON u.id = pc."usuarioId"
        WHERE pc."proyectoId" = ${ctx.proyectoId} AND pc."usuarioId" = ${ctx.actorId}
          AND pc.activo = true AND u.activo = true AND u.rol = 'EVALUADOR'
          AND u."bloqueoUrgente" = false
        FOR SHARE OF pc, u`;
      if (!Array.isArray(participaciones) || participaciones.length !== 1 || !ID(participaciones[0].id))
        return { autorizado: false };
      // FOR UPDATE fija estado y pertenencia del diagnóstico, evitando un TOCTOU
      // con un envío, sustitución o cambio de estado concurrente.
      const evaluaciones = await tx.$queryRaw`SELECT id, "proyectoId", estado FROM "Evaluacion"
        WHERE id = ${diagnosticoId} AND "proyectoId" = ${ctx.proyectoId} FOR UPDATE`;
      if (!Array.isArray(evaluaciones) || evaluaciones.length !== 1 ||
          evaluaciones[0].id !== diagnosticoId || evaluaciones[0].proyectoId !== ctx.proyectoId ||
          !['ENVIADA','EN_REVISION'].includes(evaluaciones[0].estado))
        throw falla('ALT312_DIAGNOSTICO_NO_REVISABLE');
      return { autorizado: true, proyectoId: ctx.proyectoId, actorId: ctx.actorId,
        operacion: ctx.operacion };
    },
    ejecutar: async (tx, ctx) => {
      // El resultado de cada update se verifica; si falta cualquier respuesta,
      // se revierte TODO, incluyendo comentarios y eventos previos del lote.
      for (const c of items) {
        const updated = await tx.respuesta.updateMany({
          where: { evaluacionId: diagnosticoId, preguntaId: c.preguntaId },
          data: { comentarioEvaluador: c.comentario },
        });
        if (updated?.count !== 1) throw falla('ALT312_RESPUESTA_NO_EXISTE');
      }
      const updated = await tx.evaluacion.updateMany({
        where: { id: diagnosticoId, proyectoId: ctx.proyectoId,
          estado: { in: ['ENVIADA','EN_REVISION'] } },
        data: { estado: 'EN_REVISION' },
      });
      if (updated?.count !== 1) throw falla('ALT312_DIAGNOSTICO_NO_REVISABLE');
      await tx.eventoProyecto.create({ data: {
        proyectoId: ctx.proyectoId, usuarioId: ctx.actorId, accion: 'DIAGNOSTICO_REVISADO',
        detalle: { diagnosticoId, preguntas: items.map(c => c.preguntaId) },
      }});
      return { message: 'Comentarios registrados con autor y fecha.' };
    },
  });
}
module.exports = { revisarDiagnosticoResguardadoALT };
