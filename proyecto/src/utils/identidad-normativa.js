'use strict';
// Identidad del servicio, no dictamen normativo ni verificacion contractual.
// Nuevas ediciones/enmiendas: requieren formalizacion y control de cambios; prohibido
// que una llamada de alta interprete automaticamente una edicion diferente.
const EDICIONES_INICIALES = Object.freeze({ ISO_27001: '2022', ISO_42001: '2023' });
function clasificarAlta(body) {
  if (!body || typeof body !== 'object') return null;
  const { normaCodigo, edicionNormativa } = body;
  if (typeof normaCodigo !== 'string' || typeof edicionNormativa !== 'string') return null;
  if (!Object.hasOwn(EDICIONES_INICIALES, normaCodigo)) return null;
  if (EDICIONES_INICIALES[normaCodigo] !== edicionNormativa) return null;
  return { normaCodigo, edicionNormativa };
}
module.exports = { clasificarAlta, EDICIONES_INICIALES };
