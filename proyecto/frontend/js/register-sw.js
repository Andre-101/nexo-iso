/* El modo offline heredado se desactiva para evitar almacenar evidencia privada. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        if (registration.scope.startsWith(location.origin + '/')) await registration.unregister();
      }
      if ('caches' in window) for (const key of await caches.keys()) {
        if (key.startsWith('iso27001-cache-')) await caches.delete(key);
      }
    } catch { /* No impide el acceso al portal. */ }
  });
}
