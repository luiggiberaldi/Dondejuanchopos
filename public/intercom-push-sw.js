/* Loaded by Workbox's generated service worker through workbox.importScripts,
   or directly as standalone push service worker in development/fallback environments. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
    let payload = {};
    try {
        payload = event.data?.json() || {};
    } catch {
        payload = { body: event.data?.text() || 'Tienes un mensaje nuevo.' };
    }

    const primaryDeviceId = new URL(payload.url || '/', self.location.origin).searchParams.get('conversation') || '';
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const visibleClient = windows.find(client => {
            try {
                const clientUrl = new URL(client.url);
                const clientPrimary = clientUrl.searchParams.get('conversation');
                return clientPrimary === primaryDeviceId && client.visibilityState === 'visible';
            } catch {
                return false;
            }
        });
        if (visibleClient) {
            visibleClient.postMessage({ type: 'INTERCOM_PUSH', primaryDeviceId });
            return;
        }
        await self.registration.showNotification(payload.title || 'Nuevo mensaje', {
            body: payload.body || 'Tienes un mensaje nuevo.',
            icon: '/apple-touch-icon.png',
            badge: '/apple-touch-icon.png',
            tag: payload.tag || `intercom-${primaryDeviceId}`,
            data: { primaryDeviceId, url: payload.url || '/?intercom=1' },
            renotify: false,
        });
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || '/?intercom=1', self.location.origin);
    target.searchParams.set('intercom', '1');
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find(client => new URL(client.url).origin === target.origin);
        if (existing) {
            await existing.focus();
            existing.postMessage({ type: 'INTERCOM_OPEN', primaryDeviceId: event.notification.data?.primaryDeviceId || '' });
            if ('navigate' in existing) await existing.navigate(target.href);
            return;
        }
        await self.clients.openWindow(target.href);
    })());
});
