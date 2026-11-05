/** Strict origins. localhost and 127.0.0.1 are equivalent only on the SAME configured port.
 * External origins are admitted solely when configured; never reflect an arbitrary Origin.
 */
function allowedWebOrigins(frontendUrl='http://localhost:8080',webPort='8080') {
  const out = new Set();
  let url;
  try { url = new URL(frontendUrl || `http://localhost:${webPort}`); }
  catch { throw new Error('FRONTEND_URL debe ser un origen HTTP(S) válido.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error('FRONTEND_URL debe ser únicamente un origen HTTP(S).');
  out.add(url.origin);
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    const twin = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    out.add(`${url.protocol}//${twin}${url.port ? ':'+url.port : ''}`);
  }
  return out;
}
module.exports = {allowedWebOrigins};
