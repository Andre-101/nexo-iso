'use strict';
/**
 * ALT310 — primera integración de la guardia ALT en una escritura ordinaria:
 * creación de un diagnóstico BORRADOR. No modifica G2 ni permite reactivaciones.
 *
 * La autorización HTTP preliminar NO basta: la identidad vigente, la empresa y
 * el proyecto se revalidan DENTRO de la transacción y después del candado ALT.
 * No se admiten permisos / callbacks ni datos de identidad enviados por HTTP.
 */
const { ejecutarOperacionResguardadaALT } = require('./alt-guardia-operaciones-307');
const ID = x => Number.isInteger(x) && x > 0 && x <= 2147483647;
const fallo = code => Object.assign(new Error(code), { code });

async function crearDiagnosticoResguardadoALT({ db, proyectoId, actorId } = {}) {
  if (!db || !ID(proyectoId) || !ID(actorId)) throw fallo('ALT310_ENTRADA_INVALIDA');
  let acreditada = null; // ámbito exclusivo de esta invocación; se recalcula ante P2034.
  return ejecutarOperacionResguardadaALT({
    db, proyectoId, actorId, operacion: 'INICIAR_DIAGNOSTICO',
    autorizarOrdinariamente: async (tx, ctx) => {
      acreditada = null;
      if (typeof tx?.$queryRaw !== 'function' || !tx?.evaluacion?.create)
        throw fallo('ALT310_FUENTE_NO_ACREDITADA');
      // FOR SHARE conserva la identidad del proyecto, del actor y del titular
      // del vínculo empresarial durante toda la transacción. Previene el TOCTOU
      // en el que ADMIN cambia representante o bloquea una cuenta tras autorizar.
      // Los SQL son parametrizados; no se acepta ningún identificador del body.
      const proyectos = await tx.$queryRaw`SELECT id, "empresaId", estado FROM "ProyectoConsultoria"
        WHERE id = ${ctx.proyectoId} FOR SHARE`;
      const p = proyectos?.length === 1 ? proyectos[0] : null;
      if (!p || p.id !== ctx.proyectoId || p.estado !== 'ACTIVO' || !ID(p.empresaId))
        return { autorizado: false };
      const usuarios = await tx.$queryRaw`SELECT id, rol, activo, "bloqueoUrgente" FROM "Usuario"
        WHERE id = ${ctx.actorId} FOR SHARE`;
      const u = usuarios?.length === 1 ? usuarios[0] : null;
      if (!u || u.id !== ctx.actorId || u.activo !== true || u.bloqueoUrgente === true)
        return { autorizado: false };
      const empresas = await tx.$queryRaw`SELECT id, "usuarioId" FROM "Empresa"
        WHERE id = ${p.empresaId} FOR SHARE`;
      const e = empresas?.length === 1 ? empresas[0] : null;
      if (!e || e.id !== p.empresaId || !ID(e.usuarioId))
        return { autorizado: false };
      const autorizado = u.rol === 'ADMIN' || (u.rol === 'EMPRESARIO' && e.usuarioId === ctx.actorId);
      if (autorizado) acreditada = Object.freeze({ empresaId: p.empresaId, empresarioId: e.usuarioId });
      return { autorizado, proyectoId: ctx.proyectoId, actorId: ctx.actorId,
        operacion: ctx.operacion };
    },
    ejecutar: (tx, ctx) => {
      if (!acreditada || !ID(acreditada.empresaId) || !ID(acreditada.empresarioId))
        throw fallo('ALT310_FUENTE_NO_ACREDITADA');
      return tx.evaluacion.create({ data: {
        proyectoId: ctx.proyectoId, empresaId: acreditada.empresaId,
        empresarioId: acreditada.empresarioId, estado: 'BORRADOR',
      } });
    },
  });
}
module.exports = { crearDiagnosticoResguardadoALT };
