import { describe, test, expect, beforeEach } from 'vitest';
import {
    getInstanceId,
    hasServiceWorker,
    readGate,
    resetGateCacheForTests,
    canProcessCommands,
} from '../src/utils/instanceFingerprint';

describe('canProcessCommands (decisión pura de la puerta)', () => {
    test('gate inexistente (null) → fail-open, permite', () => {
        expect(canProcessCommands(null, 'abc')).toEqual({ allowed: true, reason: 'gate-sin-registrar' });
    });

    test('gate sin primaryInstanceId → fail-open, permite', () => {
        expect(canProcessCommands({}, 'abc').allowed).toBe(true);
        expect(canProcessCommands({ other: 1 }, 'abc').allowed).toBe(true);
    });

    test('gate con MI id → permitido (instancia primaria)', () => {
        const r = canProcessCommands({ primaryInstanceId: 'abc', registeredAt: '2026-09-12' }, 'abc');
        expect(r.allowed).toBe(true);
        expect(r.reason).toBe('instancia-primaria');
    });

    test('gate con id DISTINTO → bloqueado (fantasma aislada)', () => {
        const r = canProcessCommands({ primaryInstanceId: 'real-pc' }, 'ghost');
        expect(r.allowed).toBe(false);
        expect(r.reason).toMatch(/no-es-instancia-primaria/);
    });
});

describe('getInstanceId (persistencia por navegador)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test('genera y persiste un id estable', () => {
        const a = getInstanceId();
        const b = getInstanceId();
        expect(a).toBe(b);
        expect(a).toBeTruthy();
        expect(localStorage.getItem('dj_instance_id')).toBe(a);
    });

    test('sobrevive a recargas lógicas (misma storage)', () => {
        const a = getInstanceId();
        // simular recarga: nueva lectura desde storage persistida
        const stored = localStorage.getItem('dj_instance_id');
        expect(stored).toBe(a);
    });
});

describe('hasServiceWorker', () => {
    test('devuelve booleano sin lanzar', () => {
        expect(typeof hasServiceWorker()).toBe('boolean');
    });
});

describe('readGate (cache y forma del payload)', () => {
    beforeEach(() => {
        resetGateCacheForTests();
    });

    const makeClient = (payload, calls) => ({
        rpc: async (_fn, _args) => {
            calls.push(1);
            return { data: payload ? [{ data: { payload } }] : [{ data: { payload: null } }], error: null };
        },
    });

    test('sin gate en la nube → null (fail-open aguas abajo)', async () => {
        const calls = [];
        const g = await readGate('DEV', makeClient(null, calls));
        expect(g).toBeNull();
    });

    test('cachea la lectura por TTL (1 RPC para N llamadas)', async () => {
        const calls = [];
        const client = makeClient({ primaryInstanceId: 'x' }, calls);
        await readGate('DEV', client);
        await readGate('DEV', client);
        await readGate('DEV', client);
        expect(calls.length).toBe(1);
        expect(await readGate('DEV', client)).toEqual({ primaryInstanceId: 'x' });
    });

    test('error de RPC → null sin lanzar (fail-open)', async () => {
        const client = { rpc: async () => { throw new Error('boom'); } };
        expect(await readGate('DEV', client)).toBeNull();
    });
});

describe('buildLocalRemoteBackup (firma de identidad FASE 3A)', async () => {
    const { buildLocalRemoteBackup } = await import('../src/services/remoteAuditService');

    test('incluye instanceId e instanceHasServiceWorker en el backup', () => {
        const bk = buildLocalRemoteBackup('DEV-1', 'req-1', {}, {}, '2026-09-12T00:00:00Z', 'inst-abc', true);
        expect(bk.instanceId).toBe('inst-abc');
        expect(bk.instanceHasServiceWorker).toBe(true);
        expect(bk.version).toBe('2.1');
    });

    test('sin identidad explícita los campos quedan null (compatibilidad)', () => {
        const bk = buildLocalRemoteBackup('DEV-1', 'req-1', {}, {});
        expect(bk.instanceId).toBeNull();
        expect(bk.instanceHasServiceWorker).toBeNull();
    });
});
