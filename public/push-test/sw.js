/* Service worker aislado (scope /push-test/) solo para diagnosticar Web Push.
   No toca el service worker principal de la app ni sus suscripciones. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
    event.waitUntil(self.registration.showNotification('Prueba Push', {
        body: event.data?.text() || 'Notificación de diagnóstico',
    }));
});
