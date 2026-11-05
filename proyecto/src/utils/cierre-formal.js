/** DEC-Q61: precondiciones para cierre satisfactorio; no es una orden de cierre. */
'use strict';
const { ESTADO: ESTADO_SGSI } = require('./resultadoOrientativo');
const { tieneConservacionRegistrada } = require('./conservacion-registrada');
const { resumirVigenciaInforme } = require('./sol35-informes');

/** Debe llamarse dentro de la misma transacción de una futura operación de cierre.
 * Jamás permite concluir formalmente mientras falten la conservación contractual
 * o la validación profesional del criterio de preparación.
 */
async function evaluarCierreFormal(db, proyectoId, estadoProyecto) {
  const [conservacion, informe, eventosInforme] = await Promise.all([
    db.condicionConservacionProyecto.findFirst({ where: { proyectoId }, orderBy: { id: 'desc' },
      select: { id: true, referenciaAcuerdo: true, periodoPactado: true, constanciaValidacion: true } }),
    db.informePreparacionProyecto.findFirst({ where: { proyectoId }, orderBy: { numero: 'desc' },
      select: { id: true, numero: true } }),
    db.eventoProyecto.findMany({ where: { proyectoId, accion: { in: ['INFORME_AFECTADO_SOL35','INFORME_SUSTITUIDO_SOL35'] } },
      select: { id: true, accion: true, detalle: true }, orderBy: { id: 'asc' } }),
  ]);
  const impedimentos = [];
  if (estadoProyecto !== 'ACTIVO') impedimentos.push({ codigo: 'PROYECTO_NO_ACTIVO', mensaje: 'El cierre satisfactorio solo se considera para proyectos activos; los ya cerrados no se reabren.' });
  if (!tieneConservacionRegistrada(conservacion))
    impedimentos.push({ codigo: 'CONSERVACION_NO_REGISTRADA', mensaje: 'ADMIN debe registrar las condiciones de conservación del contrato formalizado antes del cierre.' });
  if (!informe) impedimentos.push({ codigo: 'INFORME_PRINCIPAL_NO_REGISTRADO', mensaje: 'Se necesita un informe de preparación publicado por el consultor principal antes de cualquier cierre satisfactorio.' });
  // SOL-35: un informe afectado pendiente de sustitución no puede usarse
  // como fundamento vigente del cierre satisfactorio aunque exista un PDF.
  const afectados = [...resumirVigenciaInforme(eventosInforme).entries()]
    .filter(([, v]) => v.estado === 'REQUIERE_ACTUALIZACION').map(([id]) => id);
  if (afectados.length) impedimentos.push({ codigo: 'INFORME_AFECTADO_PENDIENTE',
    mensaje: 'Informe(s) afectado(s) por corrección requieren sustitución profesional antes del cierre satisfactorio.',
    informeIds: afectados });
  // DEC-P02: nunca interpretar el informe interno como un dictamen favorable automático.
  if (ESTADO_SGSI === 'PENDIENTE_VALIDACION_EXPERTA')
    impedimentos.push({ codigo: 'CRITERIOS_SGSI_PENDIENTES', mensaje: 'Los criterios de preparación y el instrumento diagnóstico requieren validación profesional.' });
  return { elegible: false, impedimentos, conservacionId: conservacion?.id ?? null,
    informeId: informe?.id ?? null, tipo: 'CIERRE_SATISFACTORIO',
    alcance: 'Prevalidación parcial: no evalúa todos los pendientes, auditorías, revisión por la dirección ni cierre definitivo.' };
}
module.exports = { evaluarCierreFormal };
