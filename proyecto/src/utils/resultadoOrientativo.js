/**
 * P-02/P-08: los promedios autodeclarados NO son un dictamen de preparación
 * ni un umbral de admisión o certificabilidad. La validación experta está pendiente.
 * Mantener intactos los valores históricos persistidos (auditabilidad), pero
 * no exponer categorías obsoletas como decisiones actuales del producto.
 */
'use strict';
const ESTADO = 'PENDIENTE_VALIDACION_EXPERTA';
const AVISO = 'Autodiagnóstico orientativo, basado en respuestas autodeclaradas. El cuestionario y los criterios de preparación requieren validación de un especialista SGSI. No demuestra cumplimiento ni preparación para la certificación.';
function presentarEvaluacion(evaluacion) {
  if (!evaluacion) return evaluacion;
  return {
    ...evaluacion,
    dictamen: null,
    prioritaria: false,
    requiereSoportes: false,
    mensajeDecision: AVISO,
    estadoValidacionCriterios: ESTADO,
    resultadoOrientativo: true,
    tieneClasificacionHistoricaNoValidada: Boolean(evaluacion.dictamen),
  };
}
module.exports = { ESTADO, AVISO, presentarEvaluacion };
