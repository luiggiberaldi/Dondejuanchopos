import { ApplicationServer, importVapidKeys, type ExportedVapidKeys, type PushSubscription } from 'jsr:@negrel/webpush@0.5.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';
// supabase secrets set INTERCOM_WEBHOOK_SECRET=... INTERCOM_VAPID_KEYS_JSON='...'
// INTERCOM_VAPID_SUBJECT='mailto:admin@your-domain' (VAPID JSON from exportVapidKeys).

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const webhookSecret = Deno.env.get('INTERCOM_WEBHOOK_SECRET');
const vapidJson = Deno.env.get('INTERCOM_VAPID_KEYS_JSON');
const contactInformation = Deno.env.get('INTERCOM_VAPID_SUBJECT') || 'mailto:admin@example.com';
if (!supabaseUrl || !serviceRoleKey || !webhookSecret || !vapidJson) throw new Error('Missing intercom push function secrets.');

const db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const vapidKeys = await importVapidKeys(JSON.parse(vapidJson) as ExportedVapidKeys);
const pushServer = await ApplicationServer.new({ contactInformation, vapidKeys });

Deno.serve(async request => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (request.headers.get('x-intercom-webhook-secret') !== webhookSecret) return new Response('Unauthorized', { status: 401 });
    let payload: { type?: string; record?: Record<string, unknown> };
    try { payload = await request.json(); } catch { return new Response('Invalid JSON', { status: 400 }); }

    const row = payload.record;
    if (payload.type !== 'INSERT' || typeof row?.primary_device_id !== 'string'
        || typeof row.sender_device_id !== 'string' || typeof row.id !== 'string') {
        return Response.json({ ignored: true }, { status: 202 });
    }
    const primaryDeviceId = row.primary_device_id;
    const senderDeviceId = row.sender_device_id;
    const { data: authorizedSender, error: senderError } = await db.rpc('intercom_is_active_member', {
        p_primary: primaryDeviceId,
        p_device: senderDeviceId,
    });
    if (senderError) {
        console.error('[intercom-push] sender validation failed:', senderError.message);
        return new Response('Sender validation failed', { status: 500 });
    }
    if (!authorizedSender) return Response.json({ ignored: true }, { status: 202 });

    const { data: activeMembers, error: membersError } = await db.rpc('intercom_active_members', { p_primary: primaryDeviceId });
    if (membersError) {
        console.error('[intercom-push] active members lookup failed:', membersError.message);
        return new Response('Active members lookup failed', { status: 500 });
    }
    const receiverIds = ((activeMembers || []) as Array<{ device_id: string }>)
        .map(member => member.device_id)
        .filter((deviceId: string) => deviceId !== senderDeviceId);
    if (receiverIds.length === 0) return Response.json({ delivered: 0, failed: 0 });

    const { data: subscriptions, error } = await db.from('device_push_subscriptions')
        .select('device_id,endpoint,p256dh,auth')
        .eq('primary_device_id', primaryDeviceId)
        .in('device_id', receiverIds)
        .is('revoked_at', null);
    if (error) {
        console.error('[intercom-push] subscription query failed:', error.message);
        return new Response('Subscription lookup failed', { status: 500 });
    }

    const safeId = encodeURIComponent(primaryDeviceId);
    const body = JSON.stringify({
        title: 'Nuevo mensaje · Intercomunicador',
        body: 'Tienes un mensaje nuevo.',
        tag: `intercom-${primaryDeviceId}`,
        url: `/?intercom=1&conversation=${safeId}`,
    });
    const results = await Promise.allSettled((subscriptions || []).map(async subscription => {
        const pushSubscription: PushSubscription = {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        };
        try {
            await pushServer.subscribe(pushSubscription).pushTextMessage(body, { ttl: 60 });
        } catch (pushError) {
            const status = typeof pushError === 'object' && pushError && 'status' in pushError
                ? Number((pushError as { status: unknown }).status) : 0;
            if (status === 404 || status === 410) {
                const { error: revokeError } = await db.from('device_push_subscriptions')
                    .update({ revoked_at: new Date().toISOString() }).eq('endpoint', subscription.endpoint);
                if (revokeError) throw revokeError;
                return;
            }
            throw pushError;
        }
    }));
    const failures = results.filter(result => result.status === 'rejected').length;
    if (failures) console.warn(`[intercom-push] ${failures} push deliveries failed; webhook is best effort.`);
    return Response.json({ delivered: results.length - failures, failed: failures });
});
