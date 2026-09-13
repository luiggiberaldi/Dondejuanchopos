import { describe, test, expect, vi, beforeEach } from 'vitest';

// El allocator importa la config real de Supabase y fetchCloudSalesReference;
// ambos se mockean para que la prueba sea 100% offline y determinista.
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: {} }));
vi.mock('../src/utils/salesPushMerge', () => ({
    fetchCloudSalesReference: vi.fn(),
}));

import { fetchCloudSalesReference } from '../src/utils/salesPushMerge';
import {
    maxSaleNumberOf,
    resolveClaims,
    withProvisionalMark,
    allocateSaleNumber,
} from '../src/utils/saleNumberAllocator';

const venta = (saleNumber, extra = {}) => ({ tipo: 'VENTA', saleNumber, ...extra });

/** Cliente Supabase falso con encadenamiento select/eq/maybeSingle/insert/contains/...
 *  La relectura de supervisor_commands devuelve los INSERTS capturados (como la
 *  ronda real) más reclamos externos inyectables para simular colisiones. */
function mkClient({ pairings = [{ monitor_device_id: 'MON-1' }], insertError = null, extraClaims = [] } = {}) {
    const inserted = [];
    const updates = [];
    const client = {
        _inserted: inserted,
        _updates: updates,
        from(table) {
            if (table === 'device_pairings') {
                return {
                    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: pairings[0] || null, error: null }) }) }),
                };
            }
            // supervisor_commands
            return {
                insert: (row) => {
                    inserted.push(row);
                    return { error: insertError ? { message: insertError } : null };
                },
                update: (patch) => {
                    // Self-confirmación del reclamo (pending → applied).
                    updates.push({ patch, at: Date.now() + updates.length });
                    const chain = {
                        eq: () => chain,
                        contains: () => chain,
                        then: (resolve) => resolve({ data: [], error: null }),
                        catch: (reject) => Promise.resolve({ data: [], error: null }).catch(reject),
                    };
                    return chain;
                },
                select: () => {
                    // Objeto thenable encadenable: await chain → reclamos "persistidos".
                    const chain = {
                        eq: () => chain,
                        in: () => chain,
                        contains: () => chain,
                        gte: () => chain,
                        order: () => chain,
                        limit: () => chain,
                        then: (resolve, reject) => {
                            const data = [
                                ...extraClaims,
                                ...inserted.map((row) => ({ payload: row.payload })),
                            ];
                            resolve({ data, error: null });
                        },
                        catch: (reject) => Promise.resolve({ data: [], error: null }).catch(reject),
                    };
                    return chain;
                },
            };
        },
    };
    return client;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('dj_instance_id', 'test-instance');
    // El caché del monitor vinculado persiste entre tests (jsdom) — limpiarlo
    // para que cada prueba de fallback pruebe el camino SIN monitor.
    localStorage.removeItem('dj_cloud_merge_monitor_id');
});

describe('maxSaleNumberOf', () => {
    test('array vacío o null → 0', () => {
        expect(maxSaleNumberOf([])).toBe(0);
        expect(maxSaleNumberOf(null)).toBe(0);
        expect(maxSaleNumberOf(undefined)).toBe(0);
    });
    test('solo cuenta saleNumber numéricos y de cualquier tipo (los abonos también consumen numeración)', () => {
        expect(maxSaleNumberOf([
            venta(5),
            { tipo: 'COBRO_DEUDA', saleNumber: 11 }, // abono: consume número
            { tipo: 'REGISTRO_CIERRE', saleNumber: 999 }, // cierre con basura numérica: cuenta
            venta('x'),
            venta(12),
            { tipo: 'REGISTRO_CIERRE' }, // sin saleNumber: no afecta
        ])).toBe(999);
        expect(maxSaleNumberOf([venta(5), { tipo: 'COBRO_DEUDA', saleNumber: 11 }])).toBe(11);
    });
});

describe('resolveClaims (compactación secuencial determinista)', () => {
    test('sin reclamos → mapa vacío', () => {
        expect(resolveClaims([]).size).toBe(0);
        expect(resolveClaims(null).size).toBe(0);
    });
    test('un reclamo recibe su candidato', () => {
        expect(resolveClaims([{ claimKey: 'a', candidate: 830, createdAt: 't1' }]).get('a')).toBe(830);
    });
    test('sin colisiones conserva los candidatos', () => {
        const r = resolveClaims([
            { claimKey: 'a', candidate: 830, createdAt: 't1' },
            { claimKey: 'b', candidate: 831, createdAt: 't2' },
        ]);
        expect(r.get('a')).toBe(830);
        expect(r.get('b')).toBe(831);
    });
    test('colisión: el más antiguo gana su candidato, el otro corre hacia arriba', () => {
        const r = resolveClaims([
            { claimKey: 'b', candidate: 830, createdAt: 't2' },
            { claimKey: 'a', candidate: 830, createdAt: 't1' },
        ]);
        expect(r.get('a')).toBe(830); // más antiguo
        expect(r.get('b')).toBe(831); // corrido
    });
    test('candidato menor que el cursor avanza al cursor (sin huecos)', () => {
        const r = resolveClaims([
            { claimKey: 'a', candidate: 5, createdAt: 't1' },
            { claimKey: 'b', candidate: 5, createdAt: 't2' },
            { claimKey: 'c', candidate: 5, createdAt: 't3' },
        ]);
        expect([...r.values()]).toEqual([5, 6, 7]);
    });
    test('empate total (candidate+createdAt) lo resuelve claimKey de forma estable', () => {
        const r1 = resolveClaims([
            { claimKey: 'x', candidate: 9, createdAt: 't' },
            { claimKey: 'y', candidate: 9, createdAt: 't' },
        ]);
        const r2 = resolveClaims([
            { claimKey: 'y', candidate: 9, createdAt: 't' },
            { claimKey: 'x', candidate: 9, createdAt: 't' },
        ]);
        expect(r1.get('x')).toBe(r2.get('x'));
        expect(r1.get('y')).toBe(r2.get('y'));
        expect(new Set(r1.values()).size).toBe(2); // sin duplicados
    });
});

describe('withProvisionalMark', () => {
    test('marca la venta sin alterar el resto', () => {
        const marked = withProvisionalMark({ id: 'v1', saleNumber: 824 }, 'sin nube');
        expect(marked.saleNumberProvisional).toBe(true);
        expect(marked.saleNumberNote).toBe('sin nube');
        expect(marked.id).toBe('v1');
    });
});

describe('allocateSaleNumber — camino NUBE', () => {
    const T1 = '2026-09-12T18:00:00.000Z';

    test('candidato = max(cloud, local)+1; reclamo insertado como applied (nunca se procesa como comando)', async () => {
        fetchCloudSalesReference.mockResolvedValue([venta(829)]);
        const client = mkClient();

        const res = await allocateSaleNumber('DEV-1', {
            localSales: [venta(823)],
            client,
            now: T1,
        });

        expect(res).toEqual({ saleNumber: 830, provisional: false, source: 'cloud' });
        expect(client._inserted).toHaveLength(1);
        expect(client._inserted[0].status).toBe('pending'); // RLS exige pending en el INSERT
        expect(client._updates).toHaveLength(1); // y el emisor se autoconfirma
        expect(client._updates[0].patch).toEqual({ status: 'applied' });
        expect(client._inserted[0].payload.action).toBe('sale_number_claim');
        expect(client._inserted[0].payload.candidate).toBe(830);
    });

    test('colisión en vivo: la compactación asigna el siguiente número', async () => {
        fetchCloudSalesReference.mockResolvedValue([venta(829)]);
        const client = mkClient({
            extraClaims: [{ payload: { claimKey: 'otro', candidate: 830, requestedAt: '2026-09-12T17:59:00.000Z' } }],
        });
        const res = await allocateSaleNumber('DEV-1', { localSales: [], client, now: T1 });
        expect(res.saleNumber).toBe(831); // el reclamo externo (más antiguo) gana 830
        expect(res.provisional).toBe(false);
    });

    test('dos allocations concurrentes obtienen números distintos (el posterior cede al reclamo previo que ve)', async () => {
        fetchCloudSalesReference.mockResolvedValue([venta(829)]);
        // Simulación secuencial de dos rondas: B ve el reclamo de A con timestamp ANTERIOR
        // (como ocurre en la realidad: B se emite después). La compactación garantiza
        // que B ceda el número más bajo a A aunque los candidatos colisionen.
        const clientA = mkClient();
        const resA = await allocateSaleNumber('DEV-1', { localSales: [], client: clientA, now: T1 });
        const clientB = mkClient({
            extraClaims: clientA._inserted.map((r) => ({ payload: { ...r.payload, requestedAt: '2026-09-12T17:59:00.000Z' } })),
        });
        const resB = await allocateSaleNumber('DEV-1', { localSales: [], client: clientB, now: T1 });
        expect(resA.saleNumber).toBe(830);
        expect(resB.saleNumber).toBe(831); // candidato colisionado → corrido por la compactación
    });

    test('guardia monótona: local no empujado más alto que la nube no se pisa', async () => {
        fetchCloudSalesReference.mockResolvedValue([venta(829)]);
        // Local tiene 840 → candidato 841; la compactación respeta >= cursor.
        const res = await allocateSaleNumber('DEV-1', { localSales: [venta(840)], client: mkClient(), now: T1 });
        expect(res.saleNumber).toBe(841);
    });

    test('un COBRO_DEUDA local sin empujar eleva el candidato (no se numera dos veces un abono)', async () => {
        fetchCloudSalesReference.mockResolvedValue([venta(829)]);
        const res = await allocateSaleNumber('DEV-1', {
            localSales: [{ tipo: 'COBRO_DEUDA', saleNumber: 830 }],
            client: mkClient(),
            now: T1,
        });
        expect(res.saleNumber).toBe(831);
    });
});

describe('allocateSaleNumber — camino FALLBACK (offline)', () => {
    test('sin nube → max(local)+1 marcado provisional con nota', async () => {
        fetchCloudSalesReference.mockRejectedValue(new Error('alloc-timeout'));
        const res = await allocateSaleNumber('DEV-1', { localSales: [venta(829)], client: mkClient(), now: 't' });
        expect(res.saleNumber).toBe(830);
        expect(res.provisional).toBe(true);
        expect(res.source).toBe('fallback');
        expect(res.note).toContain('provisional');
    });

    test('sin monitor vinculado → fallback (no devuelve número sin reclamo)', async () => {
        fetchCloudSalesReference.mockResolvedValue([venta(829)]);
        const res = await allocateSaleNumber('DEV-1', {
            localSales: [venta(100)],
            client: mkClient({ pairings: [] }),
            now: 't',
        });
        expect(res.provisional).toBe(true);
        expect(res.saleNumber).toBe(101);
    });

    test('error de insert del reclamo → fallback', async () => {
        fetchCloudSalesReference.mockResolvedValue([venta(829)]);
        const res = await allocateSaleNumber('DEV-1', {
            localSales: [venta(829)],
            client: mkClient({ insertError: 'fkey violation' }),
            now: 't',
        });
        expect(res.provisional).toBe(true);
        expect(res.saleNumber).toBe(830);
    });

    test('sin localSales → fallback al menos devuelve 1', async () => {
        fetchCloudSalesReference.mockRejectedValue(new Error('offline'));
        const res = await allocateSaleNumber('DEV-1', { localSales: null, client: mkClient(), now: 't' });
        expect(res.saleNumber).toBe(1);
        expect(res.provisional).toBe(true);
    });
});
