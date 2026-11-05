/* Compatibilidad de desinstalación: no almacenar ni responder contenido privado desde caché. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
