// G0: política temporal restrictiva hasta incorporar las asignaciones por proyecto.
// El rol EVALUADOR no concede acceso transversal a los datos de los clientes.
function puedeVerEmpresa(usuario, empresa) {
  return usuario.rol === 'ADMIN' || (usuario.rol === 'EMPRESARIO' && empresa.usuarioId === usuario.id);
}
function puedeVerEvaluacion(usuario, evaluacion) {
  // Q-59: empresarioId identifica al creador historico, no al propietario actual del acceso.
  // Sin Empresa cargada se deniega por defecto para evitar fuga de evaluaciones.
  return usuario.rol === 'ADMIN' || (usuario.rol === 'EMPRESARIO' && evaluacion.empresa?.usuarioId === usuario.id);
}
// Prisma representa los identificadores del esquema como PostgreSQL INT4;
// Number.MAX_SAFE_INTEGER es valido para JS pero provoca ToSql / 500.
const MAX_ID_POSTGRES=2147483647;
function idValido(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_ID_POSTGRES ? n : null;
}
module.exports = { puedeVerEmpresa, puedeVerEvaluacion, idValido };
