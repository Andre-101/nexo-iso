'use strict';
/**
 * ALT315: crea brechas del proyecto con el mismo candado que formaliza
 * el corte ALT306. No altera G2 ni autoriza por sí mismo a un consultor.
 * El origen del diagnóstico, cuando existe, debe pertenecer al proyecto.
 * Toda escritura y el evento histórico comparten la misma transacción.
 */
const { ejecutarOperacionResguardadaALT } = require('./alt-guardia-operaciones-307');
const ID = x => Number.isInteger(x) && x > 0 && x <= 2147483647;
const fallo = code => Object.assign(new Error(code), { code });
const texto = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;

async function registrarBrechaResguardadaALT({ db, proyectoId, actorId,
  titulo, descripcion, criterio, origenEvaluacionId = null } = {}) {
  if (!db || !ID(proyectoId) || !ID(actorId) || !texto(titulo, 180) ||
      !texto(descripcion, 8000) || !texto(criterio, 3000) ||
      (origenEvaluacionId !== null && !ID(origenEvaluacionId)))
    throw fallo('ALT315_ENTRADA_INVALIDA');
  const datos = { titulo: titulo.trim(), descripcion: descripcion.trim(),
    criterio: criterio.trim(), origenEvaluacionId };
  return ejecutarOperacionResguardadaALT({db, proyectoId, actorId,
    operacion: 'CREAR_APORTE',
    autorizarOrdinariamente: async (tx, ctx) => {
      if (typeof tx?.$queryRaw !== 'function' || typeof tx?.brechaProyecto?.create !== 'function' ||
          typeof tx?.eventoProyecto?.create !== 'function')
        throw fallo('ALT315_FUENTE_NO_ACREDITADA');
      // Candado ALT adquirido por la guardia. Bloquear las fuentes de autorización
      // para evitar revocación concurrente entre lectura y creación de la brecha.
      const proyectos = await tx.$queryRaw`SELECT id, estado FROM "ProyectoConsultoria"
        WHERE id = ${ctx.proyectoId} FOR SHARE`;
      if (proyectos?.length !== 1 || proyectos[0].id !== ctx.proyectoId ||
          proyectos[0].estado !== 'ACTIVO') return { autorizado: false };
      const participaciones = await tx.$queryRaw`SELECT pc.id FROM "ParticipacionConsultor" pc
        JOIN "Usuario" u ON u.id = pc."usuarioId"
        WHERE pc."proyectoId" = ${ctx.proyectoId} AND pc."usuarioId" = ${ctx.actorId}
          AND pc.activo = true AND u.activo = true AND u.rol = 'EVALUADOR'
          AND u."bloqueoUrgente" = false FOR SHARE OF pc, u`;
      if (!Array.isArray(participaciones) || participaciones.length !== 1 ||
          !ID(participaciones[0].id)) return { autorizado: false };
      if (origenEvaluacionId !== null) {
        const origenes = await tx.$queryRaw`SELECT id, "proyectoId" FROM "Evaluacion"
          WHERE id = ${origenEvaluacionId} AND "proyectoId" = ${ctx.proyectoId} FOR SHARE`;
        if (!Array.isArray(origenes) || origenes.length !== 1 ||
            origenes[0].id !== origenEvaluacionId ||
            origenes[0].proyectoId !== ctx.proyectoId)
          throw fallo('ALT315_ORIGEN_CRUZADO');
      }
      return { autorizado: true, proyectoId: ctx.proyectoId, actorId: ctx.actorId,
        operacion: ctx.operacion };
    },
    ejecutar: async (tx, ctx) => {
      const brecha = await tx.brechaProyecto.create({ data: {
        proyectoId: ctx.proyectoId, reportadaPorId: ctx.actorId, ...datos,
      }});
      if (!ID(brecha?.id) || brecha.proyectoId !== ctx.proyectoId ||
          brecha.reportadaPorId !== ctx.actorId)
        throw fallo('ALT315_ESCRITURA_NO_ACREDITADA');
      await tx.eventoProyecto.create({ data: {
        proyectoId: ctx.proyectoId, usuarioId: ctx.actorId,
        accion: 'BRECHA_REGISTRADA', detalle: { brechaId: brecha.id },
      }});
      return brecha;
    },
  });
}
module.exports = { registrarBrechaResguardadaALT };
