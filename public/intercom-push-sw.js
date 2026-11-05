/* Loaded by Workbox's generated service worker through workbox.importScripts,
   or directly as standalone push service worker in development/fallback environments. */
const INTERCOM_ICON = '/apple-touch-icon.png';
// Android sólo usa el canal alfa del badge: debe ser una silueta sobre transparente.
const INTERCOM_BADGE = '/intercom-badge.png';
const INTERCOM_VIBRATE = [300, 120, 300, 120, 300];
const INTERCOM_MAX_LINES = 5;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function parsePushPayload(event) {
    try {
        return event.data?.json() || {};
    } catch {
        return { body: event.data?.text() || 'Tienes un mensaje nuevo.' };
    }
}

async function notifyClients(message) {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach(client => client.postMessage(message));
}

self.addEventListener('push', event => {
    const payload = parsePushPayload(event);
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

        const sender = payload.title || 'Nuevo mensaje';
        const text = payload.body || 'Tienes un mensaje nuevo.';
        const tag = payload.tag || `intercom-${primaryDeviceId}`;

        // Agrupar: si ya hay una notificación de esta conversación, se reemplaza por
        // una que cuenta los mensajes y muestra los últimos (vista expandida en Android).
        const existing = await self.registration.getNotifications({ tag }).catch(() => []);
        const previous = existing[0]?.data || null;
        const count = (previous?.count || (existing.length ? 1 : 0)) + 1;
        const lines = [...(previous?.lines || []), `${sender}: ${text}`].slice(-INTERCOM_MAX_LINES);

        const title = count > 1 ? `${count} mensajes nuevos · Intercomunicador` : sender;
        const body = count > 1 ? lines.slice().reverse().join('\n') : text;
        const actions = [{ action: 'open', title: 'Abrir chat' }];
        if (payload.read) actions.push({ action: 'read', title: 'Marcar como leído' });

        await self.registration.showNotification(title, {
            body,
            icon: INTERCOM_ICON,
            badge: INTERCOM_BADGE,
            tag,
            renotify: true,
            // silent:false = usar el sonido del canal de notificaciones de Android.
            // Web Push no permite elegir sonido ni volumen: eso lo define el canal
            // (ver docs/INTERCOMUNICADOR_PUSH_NOTIFICACIONES.md §4).
            silent: false,
            // Queda visible hasta que el usuario la toque o la deslice.
            requireInteraction: true,
            vibrate: INTERCOM_VIBRATE,
            timestamp: payload.timestamp || Date.now(),
            actions,
            data: {
                primaryDeviceId,
                url: payload.url || '/?intercom=1',
                count,
                lines,
                read: payload.read || null,
            },
        });
    })());
});

async function markConversationRead(read) {
    if (!read?.url || !read?.key || !read.primaryDeviceId || !read.readerDeviceId || !read.messageId) return;
    const endpoint = `${read.url}/rest/v1/device_message_reads?on_conflict=primary_device_id,reader_device_id`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            apikey: read.key,
            Authorization: `Bearer ${read.key}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
            primary_device_id: read.primaryDeviceId,
            reader_device_id: read.readerDeviceId,
            last_read_at: read.createdAt,
            last_read_message_id: read.messageId,
            updated_at: new Date().toISOString(),
        }),
    });
    if (!response.ok) throw new Error(`mark read failed: ${response.status}`);
}

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const data = event.notification.data || {};

    if (event.action === 'read') {
        event.waitUntil((async () => {
            try {
                await markConversationRead(data.read);
            } catch (error) {
                console.warn('[intercom-push-sw]', error);
            }
            // Las pestañas abiertas recalculan el contador de no leídos.
            await notifyClients({ type: 'INTERCOM_PUSH', primaryDeviceId: data.primaryDeviceId || '' });
        })());
        return;
    }

    const target = new URL(data.url || '/?intercom=1', self.location.origin);
    target.searchParams.set('intercom', '1');
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find(client => new URL(client.url).origin === target.origin);
        if (existing) {
            await existing.focus();
            existing.postMessage({ type: 'INTERCOM_OPEN', primaryDeviceId: data.primaryDeviceId || '' });
            if ('navigate' in existing) await existing.navigate(target.href);
            return;
        }
        await self.clients.openWindow(target.href);
    })());
});
