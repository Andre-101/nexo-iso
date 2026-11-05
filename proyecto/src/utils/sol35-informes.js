/** SOL-35: vigencia documental derivada de eventos; jamás reescribe informes. */
'use strict';
function resumirVigenciaInforme(eventos) {
  const estados = new Map();
  for (const evento of eventos || []) {
    const d = evento.detalle || {};
    if (evento.accion === 'INFORME_AFECTADO_SOL35' && Number.isInteger(d.informeId)) {
      // Un informe sustituido no vuelve a convertirse en vigente.
      const anterior = estados.get(d.informeId);
      if (anterior?.estado === 'SUSTITUIDO') continue;
      estados.set(d.informeId, { estado: 'REQUIERE_ACTUALIZACION', justificacion: d.justificacion,
        brechaId: d.brechaId, eventoId: evento.id });
    }
    if (evento.accion === 'INFORME_SUSTITUIDO_SOL35' && Number.isInteger(d.informeAnteriorId)) {
      estados.set(d.informeAnteriorId, { estado: 'SUSTITUIDO', sustituidoPorId: d.informeNuevoId,
        eventoId: evento.id });
    }
  }
  return estados;
}
module.exports = { resumirVigenciaInforme };
