/** Carga secretos desde montajes Docker, sin incluirlos en el repositorio o el comando. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const NAMES = Object.freeze([
  'DATABASE_URL', 'JWT_SECRET', 'REGISTRY_ADAPTER_TOKEN',
  'FINANCE_REAL_TOKEN', 'ANTHROPIC_API_KEY',
]);
function loadSecrets(env = process.env, readFile = fs.readFileSync) {
  for (const name of NAMES) {
    const filename = env[name + '_FILE'];
    if (!filename) continue;
    if (env[name]) throw new Error(name + ': no combinar valor directo con *_FILE.');
    if (typeof filename !== 'string' || filename.includes('\0') ||
        !path.isAbsolute(filename) || path.dirname(path.normalize(filename)) !== '/run/secrets') {
      throw new Error(name + ': ruta de secreto inválida.');
    }
    const raw = readFile(filename, 'utf8');
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8192 ||
        raw.includes('\0') || !raw.replace(/\r?\n$/, '') ||
        /[\r\n]/.test(raw.replace(/\r?\n$/, ''))) {
      throw new Error(name + ': secreto vacío, ilegible o malformado.');
    }
    env[name] = raw.replace(/\r?\n$/, '');
  }
  return env;
}
/**
 * Los secretos *_FILE se cargan una sola vez en el proceso padre.
 * Cuando una herramienta inicia otro proceso Node heredando process.env,
 * una segunda precarga de NODE_OPTIONS vería simultáneamente X y X_FILE.
 * Eliminar únicamente los punteros *_FILE del entorno del hijo evita
 * ese falso conflicto sin permitirlo al inicio del proceso principal.
 */
function environmentForChild(env = process.env) {
  const child = {...env};
  for (const name of NAMES) {
    if (child[name] && child[name + '_FILE']) delete child[name + '_FILE'];
  }
  return child;
}
if (require.main !== module) loadSecrets();
module.exports = { loadSecrets, NAMES, environmentForChild };
