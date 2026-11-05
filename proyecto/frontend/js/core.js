/* Núcleo HTTP compartido. No decide autorizaciones: la API es la autoridad.
 * Sin bundler para mantener compatibilidad con el despliegue estático existente.
 * Contrato: backend /api, JWT Bearer, JSON y FormData; pruebas en tests/frontend-core.test.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) root.ISO = api.createClient(root);
})(typeof globalThis !== 'undefined' ? globalThis : null, function () {
  'use strict';
  const ROLES = ['ADMIN', 'EMPRESARIO', 'EVALUADOR'];
  function parseUser(raw) {
    try { const u = JSON.parse(raw || 'null'); return u && Number.isSafeInteger(u.id) && ROLES.includes(u.rol) && typeof u.nombre === 'string' ? u : null; }
    catch { return null; }
  }
  function createClient(env) {
    const storage = env.sessionStorage;
    const origin = env.__API_ORIGIN__ || (env.__NEXO_SAME_ORIGIN__ ? env.location.origin : `${env.location.protocol}//${env.location.hostname}:3000`);
    const getToken = () => storage.getItem('token') || '';
    const getUser = () => parseUser(storage.getItem('user'));
    const clearSession = () => { storage.removeItem('token'); storage.removeItem('user'); };
    function setSession(data) {
      if (!data || typeof data.token !== 'string' || !data.token || !parseUser(JSON.stringify(data.usuario)))
        throw new Error('Respuesta de autenticación inválida.');
      storage.setItem('token', data.token);
      storage.setItem('user', JSON.stringify(data.usuario));
    }
    async function api(path, options = {}) {
      // La ruta llega de módulos internos, pero no debe poder redirigir el JWT
      // mediante barras invertidas, segmentos relativos o caracteres de control.
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
          /[\\\u0000-\u001f\u007f]/.test(path)) throw new Error('Ruta de API inválida.');
      let endpoint;
      try {
        const base = new URL(`${origin}/api/`);
        endpoint = new URL(`${origin}/api${path}`);
        if (endpoint.origin !== base.origin ||
            !endpoint.pathname.startsWith('/api/') ||
            path.split(/[?#]/, 1)[0].split('/').some(segment => segment === '.' || segment === '..' || /%2e/i.test(segment) || /%2f/i.test(segment) || /%5c/i.test(segment)))
          throw new Error('Ruta de API inválida.');
      } catch { throw new Error('Ruta de API inválida.'); }
      const { binary, ...rest } = options;
      const form = typeof FormData !== 'undefined' && rest.body instanceof FormData;
      const headers = { ...(rest.body && !form ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) };
      if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
      let response;
      try { response = await env.fetch(endpoint.href, { ...rest, headers, cache: 'no-store' }); }
      catch { throw new Error('No se pudo conectar con el servidor. Comprueba tu conexión y vuelve a intentar.'); }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 && path !== '/auth/login') {
          clearSession();
          if (typeof env.dispatchEvent === 'function' && typeof env.CustomEvent === 'function')
            env.dispatchEvent(new env.CustomEvent('iso:session-expired'));
        }
        const error = new Error(typeof data.message === 'string' ? data.message : `Error HTTP ${response.status}`);
        error.status = response.status; error.details = data;
        throw error;
      }
      if (binary) return response.blob();
      return response.status === 204 ? null : response.json();
    }
    return { api, getToken, getUser, clearSession, setSession, origin };
  }
  return { createClient, parseUser, ROLES };
});
