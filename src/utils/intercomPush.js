/**
 * intercomPush.js — registro de la suscripción Web Push del intercomunicador.
 *
 * `device_push_subscriptions` tiene DOS claves únicas: la PK `device_id` y
 * `UNIQUE(endpoint)`. El cliente sólo puede arbitrar una de ellas en el upsert
 * (`onConflict: 'device_id'`), así que cuando el MISMO navegador ya tiene una fila
 * con OTRO `device_id` —identidad regenerada al re-emparejar, monitor revocado y
 * re-vinculado, almacenamiento limpiado— Postgres aborta por el índice del endpoint:
 *
 *     duplicate key value violates unique constraint "device_push_subscriptions_endpoint_key"
 *
 * Ese 23505 no es un fallo de red ni de permisos: sólo hay que liberar el endpoint
 * antes de insertar. Este módulo hace esa liberación en dos capas, porque la fila
 * dueña puede ser *invisible* por RLS (un monitor ya revocado no es miembro activo):
 *
 *   1. `delete` directo por endpoint — funciona si la fila vieja sigue siendo de un
 *      miembro activo del mismo vínculo.
 *   2. RPC `intercom_register_push_subscription` (SECURITY DEFINER) — reasigna el
 *      endpoint a este dispositivo aunque la fila vieja sea invisible.
 *
 * Todo es puro respecto al cliente inyectado, así que se prueba con un cliente falso.
 */
export const PUSH_TABLE = 'device_push_subscriptions';
export const PUSH_REREGISTER_RPC = 'intercom_register_push_subscription';

/** RLS/permisos: el dispositivo no pertenece a un vínculo activo. */
export function isRlsError(error) {
    return error?.code === '42501' || error?.status === 401 || error?.status === 403;
}

/** Conflicto de unicidad sobre el endpoint (no sobre `device_id`, que es el que arbitramos). */
export function isEndpointConflict(error) {
    return error?.code === '23505' && /endpoint/i.test(String(error?.message || ''));
}

/** Fila de `device_push_subscriptions` a partir de la suscripción del navegador. */
export function buildPushRow({ primaryDeviceId, deviceId, subscriptionJson, updatedAt = new Date().toISOString() }) {
    return {
        device_id: deviceId,
        primary_device_id: primaryDeviceId,
        endpoint: subscriptionJson?.endpoint,
        p256dh: subscriptionJson?.keys?.p256dh,
        auth: subscriptionJson?.keys?.auth,
        updated_at: updatedAt,
        revoked_at: null,
    };
}

/**
 * Registra (o refresca) la suscripción de este dispositivo.
 *
 * @returns {Promise<{ok: boolean, path: string, error?: object}>}
 *   path: 'upsert' | 'released' | 'rpc' | 'rls' | 'rpc-unavailable' | 'write'
 */
export async function registerPushSubscription({
    client,
    row,
    table = PUSH_TABLE,
    rpcName = PUSH_REREGISTER_RPC,
}) {
    const upsert = () => client.from(table).upsert(row, { onConflict: 'device_id' });

    let { error } = await upsert();
    if (!error) return { ok: true, path: 'upsert' };
    if (isRlsError(error)) return { ok: false, path: 'rls', error };

    if (isEndpointConflict(error) && row?.endpoint) {
        const { error: releaseError } = await client.from(table).delete().eq('endpoint', row.endpoint);
        if (!releaseError) {
            ({ error } = await upsert());
            if (!error) return { ok: true, path: 'released' };
            if (isRlsError(error)) return { ok: false, path: 'rls', error };
        }
    }

    if (isEndpointConflict(error)) {
        let rpcError = null;
        try {
            ({ error: rpcError } = await client.rpc(rpcName, {
                p_device_id: row.device_id,
                p_primary_device_id: row.primary_device_id,
                p_endpoint: row.endpoint,
                p_p256dh: row.p256dh,
                p_auth: row.auth,
            }));
        } catch (thrown) {
            // Cliente sin `.rpc` o fallo de transporte: se reporta como RPC no
            // disponible en vez de dejar escapar un TypeError a la UI.
            rpcError = thrown;
        }
        if (!rpcError) return { ok: true, path: 'rpc' };
        if (isRlsError(rpcError)) return { ok: false, path: 'rls', error: rpcError };
        return { ok: false, path: 'rpc-unavailable', error: rpcError };
    }

    return { ok: false, path: 'write', error };
}

/**
 * Mensaje para el operador. Nunca expone el texto crudo de Postgres: el detalle
 * técnico va a `console.error` (ver `useDeviceIntercom`).
 */
export function describePushRegistrationFailure({ path, error } = {}) {
    if (path === 'rls') {
        return 'Este dispositivo ya no pertenece a un vínculo activo. Vuelve a emparejarlo para activar Push.';
    }
    if (path === 'rpc-unavailable') {
        return 'Este navegador ya tenía una suscripción Push de otro vínculo y no se pudo reasignar. Reintenta en unos minutos; si sigue igual, hay que liberarla en la nube.';
    }
    return error?.message || 'No se pudieron activar las notificaciones en este dispositivo.';
}
