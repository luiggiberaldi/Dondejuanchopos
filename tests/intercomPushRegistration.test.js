/**
 * tests/intercomPushRegistration.test.js
 *
 * El registro de Push del intercomunicador choca con DOS claves únicas:
 * PK `device_id` y `UNIQUE(endpoint)`. El upsert sólo arbitra `device_id`, así que
 * cuando el mismo navegador ya está registrado con otra identidad de dispositivo
 * Postgres devuelve 23505 y el panel mostraba el texto crudo:
 *
 *   duplicate key value violates unique constraint "device_push_subscriptions_endpoint_key"
 */
import { describe, expect, it, vi } from 'vitest';

import {
    buildPushRow,
    describePushRegistrationFailure,
    isEndpointConflict,
    isRlsError,
    registerPushSubscription,
    PUSH_REREGISTER_RPC,
    PUSH_TABLE,
} from '../src/utils/intercomPush';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

const endpointConflict = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "device_push_subscriptions_endpoint_key"',
};
const rlsDenied = { code: '42501', message: 'new row violates row-level security policy' };

/**
 * Cliente falso con la forma encadenable de supabase-js.
 * `upsertResults` se consume en orden; `deleteResults` y `rpcResults` igual.
 */
function fakeClient({ upsertResults = [{}], deleteResults = [{}], rpcResults = [{}] } = {}) {
    const calls = { upsert: [], delete: [], rpc: [] };
    const next = (queue, fallback, name, args) => {
        calls[name].push(args);
        return Promise.resolve(queue.length ? queue.shift() : fallback);
    };
    return {
        calls,
        from: vi.fn(table => ({
            upsert: (row, options) => next(upsertResults, {}, 'upsert', { table, row, options }),
            delete: () => ({
                eq: (column, value) => next(deleteResults, {}, 'delete', { table, column, value }),
            }),
        })),
        rpc: (name, args) => next(rpcResults, {}, 'rpc', { name, args }),
    };
}

const row = {
    device_id: 'monitor-nuevo',
    primary_device_id: 'caja-1',
    endpoint: ENDPOINT,
    p256dh: 'k',
    auth: 'a',
};

describe('registerPushSubscription', () => {
    it('registra con el upsert normal cuando no hay conflicto', async () => {
        const client = fakeClient({ upsertResults: [{ error: null }] });

        const result = await registerPushSubscription({ client, row });

        expect(result).toEqual({ ok: true, path: 'upsert' });
        expect(client.calls.upsert[0].table).toBe(PUSH_TABLE);
        expect(client.calls.upsert[0].options).toEqual({ onConflict: 'device_id' });
        expect(client.calls.delete).toHaveLength(0);
        expect(client.calls.rpc).toHaveLength(0);
    });

    it('libera el endpoint robado y reintenta cuando choca con otra identidad', async () => {
        const client = fakeClient({
            upsertResults: [{ error: endpointConflict }, { error: null }],
            deleteResults: [{ error: null }],
        });

        const result = await registerPushSubscription({ client, row });

        expect(result).toEqual({ ok: true, path: 'released' });
        expect(client.calls.delete).toEqual([{ table: PUSH_TABLE, column: 'endpoint', value: ENDPOINT }]);
        expect(client.calls.upsert).toHaveLength(2);
    });

    it('delega en el RPC cuando la fila dueña del endpoint es invisible por RLS', async () => {
        // El delete no borra nada (fila de otro vínculo) y el reintento vuelve a chocar:
        // el `delete` invisible no devuelve error, simplemente no afecta filas.
        const client = fakeClient({
            upsertResults: [{ error: endpointConflict }, { error: endpointConflict }],
            deleteResults: [{ error: null }],
            rpcResults: [{ error: null }],
        });

        const result = await registerPushSubscription({ client, row });

        expect(result).toEqual({ ok: true, path: 'rpc' });
        expect(client.calls.rpc[0].name).toBe(PUSH_REREGISTER_RPC);
        // Los nombres deben coincidir con la firma de
        // `intercom_register_push_subscription(p_device_id, p_primary_device_id,
        //                                     p_endpoint, p_p256dh, p_auth)`.
        expect(client.calls.rpc[0].args).toEqual({
            p_device_id: 'monitor-nuevo',
            p_primary_device_id: 'caja-1',
            p_endpoint: ENDPOINT,
            p_p256dh: 'k',
            p_auth: 'a',
        });
    });

    it('no manda el conflicto de endpoint a la UI como si fuera un fallo de red', async () => {
        const client = fakeClient({
            upsertResults: [{ error: endpointConflict }, { error: endpointConflict }],
            deleteResults: [{ error: null }],
            rpcResults: [{ error: { code: 'PGRST202', message: 'Could not find the function' } }],
        });

        const result = await registerPushSubscription({ client, row });

        expect(result.ok).toBe(false);
        expect(result.path).toBe('rpc-unavailable');
        const message = describePushRegistrationFailure(result);
        expect(message).not.toMatch(/duplicate key/i);
        expect(message).not.toMatch(/constraint/i);
        expect(message).not.toMatch(/PGRST/);
    });

    it('traduce el rechazo de RLS a la instrucción de re-emparejar', async () => {
        const client = fakeClient({ upsertResults: [{ error: rlsDenied }] });

        const result = await registerPushSubscription({ client, row });

        expect(result).toEqual({ ok: false, path: 'rls', error: rlsDenied });
        expect(describePushRegistrationFailure(result)).toContain('Vuelve a emparejarlo');
        // Sin RLS no se intenta liberar nada: no tenemos permiso sobre esa fila.
        expect(client.calls.delete).toHaveLength(0);
        expect(client.calls.rpc).toHaveLength(0);
    });

    it('un error de escritura que no es conflicto se reporta como tal', async () => {
        const writeError = { code: '08006', message: 'connection failure' };
        const client = fakeClient({ upsertResults: [{ error: writeError }] });

        const result = await registerPushSubscription({ client, row });

        expect(result).toEqual({ ok: false, path: 'write', error: writeError });
        expect(describePushRegistrationFailure(result)).toBe('connection failure');
    });
});

describe('clasificadores y fila de suscripción', () => {
    it('distingue el conflicto de endpoint de otros 23505', () => {
        expect(isEndpointConflict(endpointConflict)).toBe(true);
        expect(isEndpointConflict({ code: '23505', message: 'duplicate key value violates unique constraint "device_push_subscriptions_pkey"' })).toBe(false);
        expect(isEndpointConflict(rlsDenied)).toBe(false);
    });

    it('reconoce los rechazos de RLS por código o por HTTP', () => {
        expect(isRlsError(rlsDenied)).toBe(true);
        expect(isRlsError({ status: 401 })).toBe(true);
        expect(isRlsError({ status: 403 })).toBe(true);
        expect(isRlsError(endpointConflict)).toBe(false);
    });

    it('construye la fila desde la suscripción del navegador', () => {
        expect(buildPushRow({
            primaryDeviceId: 'caja-1',
            deviceId: 'monitor-1',
            subscriptionJson: { endpoint: ENDPOINT, keys: { p256dh: 'kk', auth: 'aa' } },
            updatedAt: '2026-10-11T10:00:00.000Z',
        })).toEqual({
            device_id: 'monitor-1',
            primary_device_id: 'caja-1',
            endpoint: ENDPOINT,
            p256dh: 'kk',
            auth: 'aa',
            updated_at: '2026-10-11T10:00:00.000Z',
            revoked_at: null,
        });
    });
});
