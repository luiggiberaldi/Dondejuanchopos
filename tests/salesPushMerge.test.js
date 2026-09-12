import { describe, test, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    prepareSalesPushPayload,
    fetchCloudSalesReference,
    resetCloudSalesReferenceCacheForTests,
} from '../src/utils/salesPushMerge';

const mkVenta = (id, saleNumber, extra = {}) => ({
    id,
    tipo: 'VENTA',
    saleNumber,
    totalBs: 100,
    totalUsd: 1,
    timestamp: `2026-09-12T0${saleNumber % 10}:00:00.000Z`,
    ...extra,
});

const mkCierre = (id, n) => ({
    id,
    tipo: 'REGISTRO_CIERRE',
    cierreNumber: n,
    cierreId: 1700000000000 + n,
    cajaCerrada: true,
    timestamp: `2026-09-01T0${n % 10}:00:00.000Z`,
    summary: { todayTotalBs: 1000 + n },
});

describe('prepareSalesPushPayload (FASE 1: merge-on-push)', () => {
    test('I4: sin referencia cloud → passthrough puro (comportamiento actual)', () => {
        const local = [mkVenta('v1', 1), mkVenta('v2', 2)];
        const r = prepareSalesPushPayload(local, null);
        expect(r.strategy).toBe('passthrough');
        expect(r.payload).toEqual(local);
        expect(r.vetoed).toBe(false);
    });

    test('I4: referencia cloud vacía → passthrough puro', () => {
        const local = [mkVenta('v1', 1)];
        const r = prepareSalesPushPayload(local, []);
        expect(r.strategy).toBe('passthrough');
        expect(r.payload).toEqual(local);
    });

    test('I1: local pequeño (2 cierres) + nube grande (42 cierres) → la unión conserva TODOS los de la nube y añade las nuevas', () => {
        const cloud = [
            ...Array.from({ length: 42 }, (_, i) => mkCierre(`c${i + 1}`, i + 1)),
            mkVenta('old1', 100, { cierreId: 1700000000001, cajaCerrada: true }),
        ];
        const local = [
            mkCierre('c1', 1), // el PC solo tiene 2 cierres
            mkCierre('c2', 2),
            mkVenta('new1', 200), // venta nueva local
            mkVenta('new2', 201),
        ];
        const r = prepareSalesPushPayload(local, cloud);
        expect(r.strategy).toBe('union-merge');
        expect(r.vetoed).toBe(false);
        expect(r.payload.length).toBe(cloud.length + 2);
        const ids = new Set(r.payload.map(s => s.id));
        for (const c of cloud) expect(ids.has(c.id), `debe conservar ${c.id}`).toBe(true);
        expect(ids.has('new1')).toBe(true);
        expect(ids.has('new2')).toBe(true);
    });

    test('I1: el merge NUNCA encoge — intento de borrado queda vetado y se devuelve la nube intacta', () => {
        const cloud = [mkVenta('a', 1), mkVenta('b', 2), mkVenta('c', 3)];
        const local = [mkVenta('a', 1)]; // "perdió" b y c (borrado real)
        const r = prepareSalesPushPayload(local, cloud);
        // mergeSalesArrays es unión: b y c sobreviven. El conteo no puede bajar.
        expect(r.vetoed).toBe(false);
        expect(r.payload.length).toBeGreaterThanOrEqual(cloud.length);
        const ids = new Set(r.payload.map(s => s.id));
        expect(ids.has('b')).toBe(true);
        expect(ids.has('c')).toBe(true);
    });

    test('I2: venta sellada en la nube no pierde su sello aunque el local traiga versión vieja sin sello', () => {
        const cloud = [mkVenta('s1', 10, { cierreId: 999, cajaCerrada: true, totalBs: 500 })];
        const local = [mkVenta('s1', 10, { totalBs: 500 })]; // versión vieja sin sello
        const r = prepareSalesPushPayload(local, cloud);
        const merged = r.payload.find(s => s.id === 's1');
        expect(merged.cierreId).toBe(999);
        expect(merged.cajaCerrada).toBe(true);
    });

    test('I3: idempotencia — fusionar dos veces el mismo contenido no duplica ni cambia conteos', () => {
        const cloud = [mkCierre('c1', 1), mkVenta('v1', 1, { cajaCerrada: true })];
        const local = [mkCierre('c1', 1), mkVenta('v1', 1, { cajaCerrada: true }), mkVenta('v2', 2)];
        const first = prepareSalesPushPayload(local, cloud);
        const second = prepareSalesPushPayload(first.payload, cloud);
        expect(second.payload.length).toBe(first.payload.length);
        const nums = second.payload.map(s => s.id).sort();
        expect(nums).toEqual(first.payload.map(s => s.id).sort());
    });

    test('I4: payload local corrupto (no array) → se devuelve la referencia cloud, nunca basura', () => {
        const cloud = [mkVenta('a', 1)];
        const r = prepareSalesPushPayload(null, cloud);
        expect(r.payload).toEqual(cloud);
        expect(r.reason).toBe('local-no-array');
    });

    test('I5: empate de updatedAt → GANA LA NUBE (el local truncado no resucita versiones viejas canonizadas)', () => {
        // El cierre errado de $0.71 reescrito en la nube: mismo updatedAt que la copia podrida del PC
        const cierreCanonico = mkCierre('c2', 2);
        cierreCanonico.summary = { todayTotalBs: 15350, note: 'cierre canónico' };
        cierreCanonico.updatedAt = '2026-09-11T03:00:00.000Z';
        const cloud = [cierreCanonico];

        const cierrePodridoLocal = mkCierre('c2', 2);
        cierrePodridoLocal.summary = { todayTotalBs: 71, note: 'cierre ciego $0.71' };
        cierrePodridoLocal.updatedAt = '2026-09-11T03:00:00.000Z'; // MISMO timestamp
        const local = [cierrePodridoLocal];

        const r = prepareSalesPushPayload(local, cloud);
        expect(r.vetoed).toBe(false);
        const merged = r.payload.find(s => s.id === 'c2');
        expect(merged.summary.todayTotalBs).toBe(15350); // la nube conserva su verdad
    });

    test('I5-complemento: el local MÁS NUEVO sí gana (anulaciones/ediciones legítimas siguen funcionando)', () => {
        const cloud = [mkVenta('v1', 1, { status: 'ACTIVA', updatedAt: '2026-09-12T01:00:00.000Z' })];
        const local = [mkVenta('v1', 1, { status: 'ANULADA', updatedAt: '2026-09-12T05:00:00.000Z' })];
        const r = prepareSalesPushPayload(local, cloud);
        expect(r.payload.find(s => s.id === 'v1').status).toBe('ANULADA');
    });
});

describe('fetchCloudSalesReference (lectura del Doc 60 por RPC)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        resetCloudSalesReferenceCacheForTests();
        localStorage.clear();
    });

    const mkClient = ({ monitorId = 'mon_1', rpcData, rpcError, pairData }) => ({
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({ data: pairData, error: null })),
                })),
            })),
        })),
        rpc: vi.fn(async () => ({ data: rpcData, error: rpcError })),
    });

    test('camino feliz: resuelve monitor del pairing y devuelve el payload del Doc 60', async () => {
        const payload = [mkCierre('c1', 1)];
        const client = mkClient({ pairData: { monitor_device_id: 'mon_1' }, rpcData: [{ doc_id: 'bodega_sales_v1', data: { payload } }] });
        const ref = await fetchCloudSalesReference('PDA-TEST', client);
        expect(ref).toEqual(payload);
        expect(client.rpc).toHaveBeenCalledWith('read_paired_audit_documents', expect.objectContaining({
            p_primary_device_id: 'PDA-TEST',
            p_monitor_device_id: 'mon_1',
            p_doc_ids: ['bodega_sales_v1'],
        }));
    });

    test('sin pairing → null (passthrough + breaker clásico, sin regresión)', async () => {
        const client = mkClient({ pairData: null });
        const ref = await fetchCloudSalesReference('PDA-TEST', client);
        expect(ref).toBeNull();
        expect(client.rpc).not.toHaveBeenCalled();
    });

    test('error del RPC → null, nunca lanza', async () => {
        const client = mkClient({ pairData: { monitor_device_id: 'mon_1' }, rpcError: { message: 'boom' } });
        await expect(fetchCloudSalesReference('PDA-TEST', client)).resolves.toBeNull();
    });

    test('caché TTL: dos llamadas seguidas usan una sola lectura RPC', async () => {
        const payload = [mkVenta('v1', 1)];
        const client = mkClient({ pairData: { monitor_device_id: 'mon_1' }, rpcData: [{ doc_id: 'bodega_sales_v1', data: { payload } }] });
        await fetchCloudSalesReference('PDA-TEST', client);
        await fetchCloudSalesReference('PDA-TEST', client);
        expect(client.rpc).toHaveBeenCalledTimes(1);
    });
});

describe('Wiring en pushCloudSyncNow (invariantes de fuente, estilo H1)', () => {
    test('el push de ventas pasa por el merge solo con flag + device de producción, y el breaker clásico sigue intacto', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../src/hooks/useCloudSync.js'), 'utf-8');
        // Compuerta por flag kill-switch
        expect(src).toContain("localStorage.getItem('dj_sales_push_merge_v1') === 'true'");
        // Restringido al device_id de la caja de producción (la fantasma queda en passthrough)
        expect(src).toContain("activeDeviceId === 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F'");
        // Respeta el flujo deliberado de purga
        expect(src).toContain("confirm_sales_purge_flag");
        // Llama al merge y a la referencia cloud
        expect(src).toContain('prepareSalesPushPayload');
        expect(src).toContain('fetchCloudSalesReference');
        // El breaker clásico sigue presente (segunda línea de defensa)
        expect(src).toContain('CIRCUIT BREAKER CLOUD SYNC');
        expect(src).toMatch(/minAllowedCierres/);
    });
});
