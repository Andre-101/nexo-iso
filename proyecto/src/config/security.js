const insecureValues = new Set([
  'cambia_esta_clave_por_una_muy_larga', 'secret', 'changeme',
  'change-me', '12345678901234567890123456789012',
]);
function validarEntorno(env = process.env) {
  if (typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 32 ||
      insecureValues.has(env.JWT_SECRET) || /REEMPLAZAR|PLACEHOLDER|EXAMPLE/i.test(env.JWT_SECRET) ||
      /^(.)\1+$/.test(env.JWT_SECRET)) {
    throw new Error('JWT_SECRET debe tener al menos 32 caracteres aleatorios y no puede ser de ejemplo.');
  }
  if (!env.DATABASE_URL || !/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL) ||
      /REEMPLAZAR|PLACEHOLDER/i.test(env.DATABASE_URL)) {
    throw new Error('DATABASE_URL PostgreSQL es obligatorio.');
  }
  if (env.NODE_ENV === 'production' && env.DATA_MODE === 'production' && env.FRONTEND_URL) {
    let frontend;
    try { frontend = new URL(env.FRONTEND_URL); } catch { throw new Error('FRONTEND_URL, si se especifica, debe ser un origen HTTPS.'); }
    if (frontend.protocol !== 'https:' || frontend.username || frontend.password ||
        frontend.pathname !== '/' || frontend.search || frontend.hash)
      throw new Error('FRONTEND_URL debe ser exclusivamente un origen HTTPS público.');
  }
}
module.exports = { validarEntorno };
