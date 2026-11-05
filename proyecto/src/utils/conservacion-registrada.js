'use strict';
/** DEC-Q60/Q61/Q62: presencia de condiciones formalizadas, NO validez legal. */
function tieneConservacionRegistrada(r) {
 return Boolean(r && r.referenciaAcuerdo?.trim() && r.periodoPactado?.trim() && r.constanciaValidacion?.trim());
}
module.exports = { tieneConservacionRegistrada };
