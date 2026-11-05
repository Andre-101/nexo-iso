'use strict';
/**
 * ALT316 — Alta de actividades bajo candado ALT306/307, con autorización
 * ordinaria fresca y todas sus relaciones/eventos en UNA transacción.
 * No es middleware global y no modifica G2, planes ni estados posteriores.
 * El candado comercial 27183 (solo ADICIONAL) se toma DESPUÉS del candado ALT;
 * no se anida en sentido inverso. Las fuentes relevantes se bloquean FOR SHARE.
 */
const { ejecutarOperacionResguardadaALT } = require('./alt-guardia-operaciones-307');
const ID = x => Number.isInteger(x) && x > 0 && x <= 2147483647;
const fallo = code => Object.assign(new Error(code), {code});
const texto = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.trim().length <= max;
const fila = (rows, predicate) => Array.isArray(rows) && rows.length === 1 && predicate(rows[0]);

async function registrarActividadResguardadaALT({db, proyectoId, actorId, titulo,
  descripcion = null, tipoResponsable, asignadoAId, brechaIds = [], fechaObjetivo = null,
  cobertura = 'BASE', acuerdoAdicionalId = null, actividadOrigenId = null} = {}) {
  if (!db || !ID(proyectoId) || !ID(actorId) || !ID(asignadoAId) ||
      !texto(titulo, 180) || !['CLIENTE', 'CONSULTORA'].includes(tipoResponsable) ||
      (descripcion !== null && (typeof descripcion !== 'string' || descripcion.length > 8000)) ||
      !Array.isArray(brechaIds) || brechaIds.length > 200 ||
      brechaIds.some(x => !ID(x)) || new Set(brechaIds).size !== brechaIds.length ||
      (fechaObjetivo !== null && !(fechaObjetivo instanceof Date && Number.isFinite(fechaObjetivo.getTime()))) ||
      !['BASE', 'ADICIONAL'].includes(cobertura) ||
      (cobertura === 'BASE' && (acuerdoAdicionalId !== null || actividadOrigenId !== null)) ||
      (cobertura === 'ADICIONAL' && (!ID(acuerdoAdicionalId) || tipoResponsable !== 'CONSULTORA')) ||
      (actividadOrigenId !== null && !ID(actividadOrigenId)))
    throw fallo('ALT316_ENTRADA_INVALIDA');

  const ids = [...brechaIds].sort((a,b) => a-b);
  return ejecutarOperacionResguardadaALT({db, proyectoId, actorId, operacion:'CREAR_APORTE',
    autorizarOrdinariamente: async (tx, ctx) => {
      if (typeof tx?.$queryRaw !== 'function' || typeof tx?.actividadProyecto?.create !== 'function' ||
          typeof tx?.actividadBrechaProyecto?.createMany !== 'function' ||
          typeof tx?.eventoProyecto?.create !== 'function')
        throw fallo('ALT316_FUENTE_NO_ACREDITADA');
      if (cobertura === 'ADICIONAL') {
        // Tras el candado ALT, solicitar el comercial ANTES de bloquear filas:
        // evita invertir el orden respecto de los escritores Q65/Q66 (27183).
        const lock = await tx.$queryRaw`SELECT (pg_advisory_xact_lock(27183,
          CAST(${ctx.proyectoId} AS INTEGER)) IS NULL) AS "bloqueoAcuerdo"`;
        // pg_advisory_xact_lock retorna VOID: IS NULL / IS NOT NULL
        // NO representa éxito/fracaso. La sentencia solo retorna DESPUÉS
        // de adquirir el candado; una falla de SQL aborta la transacción.
        // Verificamos el contrato tipado sin inferir el éxito por el valor.
        if (!fila(lock, x => typeof x.bloqueoAcuerdo === 'boolean'))
          throw fallo('ALT316_CANDADO_COMERCIAL_NO_ACREDITADO');
      }
      const proyectos = await tx.$queryRaw`SELECT id, estado, "empresaId" FROM "ProyectoConsultoria"
        WHERE id = ${ctx.proyectoId} FOR SHARE`;
      if (!fila(proyectos, x => x.id === ctx.proyectoId && x.estado === 'ACTIVO' && ID(x.empresaId)))
        return {autorizado:false};
      const principales = await tx.$queryRaw`SELECT pc.id FROM "ParticipacionConsultor" pc
        JOIN "Usuario" u ON u.id = pc."usuarioId"
        WHERE pc."proyectoId" = ${ctx.proyectoId} AND pc."usuarioId" = ${ctx.actorId}
          AND pc.activo = true AND pc.principal = true
          AND u.activo = true AND u.rol = 'EVALUADOR' AND u."bloqueoUrgente" = false
        FOR SHARE OF pc, u`;
      if (!fila(principales, x => ID(x.id))) return {autorizado:false};
      if (tipoResponsable === 'CONSULTORA') {
        const responsables = await tx.$queryRaw`SELECT pc.id FROM "ParticipacionConsultor" pc
          JOIN "Usuario" u ON u.id = pc."usuarioId"
          WHERE pc."proyectoId" = ${ctx.proyectoId} AND pc."usuarioId" = ${asignadoAId}
            AND pc.activo = true AND u.activo = true AND u.rol = 'EVALUADOR'
            AND u."bloqueoUrgente" = false FOR SHARE OF pc, u`;
        if (!fila(responsables, x => ID(x.id))) throw fallo('ALT316_RESPONSABLE_NO_AUTORIZADO');
      } else {
        const representantes = await tx.$queryRaw`SELECT e.id FROM "Empresa" e
          JOIN "Usuario" u ON u.id = e."usuarioId"
          WHERE e.id = ${proyectos[0].empresaId} AND e."usuarioId" = ${asignadoAId}
            AND u.rol = 'EMPRESARIO' AND u.activo = true AND u."bloqueoUrgente" = false
          FOR SHARE OF e, u`;
        if (!fila(representantes, x => ID(x.id))) throw fallo('ALT316_RESPONSABLE_NO_AUTORIZADO');
      }
      // Una brecha de otro expediente, incluso de la misma empresa, no se enlaza.
      // La lectura de cada fila se bloquea y el orden es estable entre llamadas.
      for (const brechaId of ids) {
        const brechas = await tx.$queryRaw`SELECT id, "proyectoId" FROM "BrechaProyecto"
          WHERE id = ${brechaId} AND "proyectoId" = ${ctx.proyectoId} FOR SHARE`;
        if (!fila(brechas, x => x.id === brechaId && x.proyectoId === ctx.proyectoId))
          throw fallo('ALT316_BRECHA_CRUZADA');
      }
      if (cobertura === 'ADICIONAL') {
        const acuerdos = await tx.$queryRaw`SELECT id FROM "AcuerdoAdicionalProyecto"
          WHERE id = ${acuerdoAdicionalId} AND "proyectoId" = ${ctx.proyectoId}
            AND estado = 'HABILITADO' FOR SHARE`;
        if (!fila(acuerdos, x => x.id === acuerdoAdicionalId)) throw fallo('ALT316_ACUERDO_NO_HABILITADO');
        if (actividadOrigenId !== null) {
          const anteriores = await tx.$queryRaw`SELECT id, "acuerdoAdicionalId" FROM "ActividadProyecto"
            WHERE id = ${actividadOrigenId} AND "proyectoId" = ${ctx.proyectoId}
              AND cobertura = 'ADICIONAL' AND "tipoResponsable" = 'CONSULTORA'
              AND estado IN ('EN_PROGRESO','EN_REVISION') FOR SHARE`;
          if (!fila(anteriores, x => x.id === actividadOrigenId && ID(x.acuerdoAdicionalId) &&
               x.acuerdoAdicionalId !== acuerdoAdicionalId))
            throw fallo('ALT316_ORIGEN_NO_APTO');
          const viejos = await tx.$queryRaw`SELECT id FROM "AcuerdoAdicionalProyecto"
            WHERE id = ${anteriores[0].acuerdoAdicionalId} AND "proyectoId" = ${ctx.proyectoId}
              AND estado IN ('CANCELADO','MODIFICADO') FOR SHARE`;
          if (!fila(viejos, x => x.id === anteriores[0].acuerdoAdicionalId))
            throw fallo('ALT316_ORIGEN_NO_APTO');
        }
      }
      return {autorizado:true, ...ctx};
    },
    ejecutar: async (tx,ctx) => {
      const act = await tx.actividadProyecto.create({data:{
        proyectoId:ctx.proyectoId, titulo:titulo.trim(), descripcion:descripcion?.trim() || null,
        tipoResponsable, asignadoAId, fechaObjetivo, cobertura, acuerdoAdicionalId, actividadOrigenId,
      }});
      if (!ID(act?.id) || act.proyectoId !== ctx.proyectoId || act.asignadoAId !== asignadoAId)
        throw fallo('ALT316_ESCRITURA_NO_ACREDITADA');
      if (brechaIds.length) {
        const linked = await tx.actividadBrechaProyecto.createMany({data:brechaIds.map(brechaId => ({
          proyectoId:ctx.proyectoId, brechaId, actividadId:act.id,
        }))});
        if (linked?.count !== brechaIds.length) throw fallo('ALT316_VINCULOS_NO_ACREDITADOS');
      }
      await tx.eventoProyecto.create({data:{proyectoId:ctx.proyectoId, usuarioId:ctx.actorId,
        accion:'ACTIVIDAD_REGISTRADA', detalle:{actividadId:act.id,brechaIds,
          ...(cobertura==='ADICIONAL'?{cobertura,acuerdoAdicionalId}:{}),
          ...(actividadOrigenId?{actividadOrigenId,continuidadSinConvalidacion:true}:{})},
      }});
      return act;
    },
  });
}
module.exports = { registrarActividadResguardadaALT };
