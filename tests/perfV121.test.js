import { describe, expect, it, vi } from 'vitest';
import { allocateSaleNumber } from '../src/utils/saleNumberAllocator';
import { compactInventoryOperationsPayload } from '../src/utils/kardexScope';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

describe('v1.2.1 — Optimizaciones de egress, polling y limpieza Realtime', () => {
    it('allocateSaleNumber usa get_sales_max_number (~119 B) sin llamar read_paired_audit_documents', async () => {
        const rpcCalls = [];
        const insertedClaims = [];
        const fakeClient = {
            rpc: vi.fn(async (name, params) => {
                rpcCalls.push({ name, params });
                if (name === 'get_sales_max_number') {
                    return { data: { success: true, max_sale_number: 1934, total_records: 2196 }, error: null };
                }
                throw new Error('NO debería llamar ' + name);
            }),
            from: vi.fn((table) => {
                if (table === 'device_pairings') {
                    return {
                        select: () => ({
                            eq: () => ({
                                maybeSingle: async () => ({ data: { monitor_device_id: 'mon_test' }, error: null }),
                            }),
                        }),
                    };
                }
                if (table === 'supervisor_commands') {
                    return {
                        insert: async (row) => {
                            insertedClaims.push({ payload: row.payload, created_at: '2026-11-22T18:05:00.000Z' });
                            return { error: null };
                        },
                        update: () => ({
                            contains: () => ({
                                eq: async () => ({ error: null }),
                            }),
                        }),
                        select: () => ({
                            eq: () => ({
                                eq: () => ({
                                    in: () => ({
                                        contains: () => ({
                                            gte: () => ({
                                                order: () => ({
                                                    limit: async () => ({ data: insertedClaims, error: null }),
                                                }),
                                            }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    };
                }
                throw new Error('Unexpected table: ' + table);
            }),
        };

        const res = await allocateSaleNumber('PDA-TEST-1', {
            localSales: [{ saleNumber: 1900 }],
            client: fakeClient,
            now: '2026-11-22T18:05:00.000Z',
        });

        expect(res.provisional).toBe(false);
        expect(res.source).toBe('cloud');
        expect(res.saleNumber).toBe(1935);
        expect(rpcCalls.map((c) => c.name)).toEqual(['get_sales_max_number']);
    });

    it('compactInventoryOperationsPayload conserva últimos 30d + operaciones pendientes antiguas y no muta el local', () => {
        const now = '2026-11-22T18:00:00.000Z';
        const ops = [
            { operationId: 'op-old-applied', status: 'APPLIED_LOCAL', createdAt: '2026-09-10T10:00:00.000Z' },
            { operationId: 'op-old-pending', status: 'PENDING', createdAt: '2026-09-10T10:00:00.000Z' },
            { operationId: 'op-old-failed', status: 'FAILED_RETRYABLE', createdAt: '2026-09-10T10:00:00.000Z' },
            { operationId: 'op-recent', status: 'APPLIED_LOCAL', createdAt: '2026-11-20T10:00:00.000Z' },
        ];
        const snapshot = structuredClone(ops);
        const compacted = compactInventoryOperationsPayload(ops, 30, now);

        expect(ops).toEqual(snapshot);
        expect(compacted.map((o) => o.operationId)).toEqual([
            'op-old-pending',
            'op-old-failed',
            'op-recent',
        ]);
    });

    it('useAutoBackup no abre suscripciones Realtime muertas contra backup_requests', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/hooks/useAutoBackup.js'), 'utf8');
        expect(src).not.toContain("table: 'backup_requests'");
    });

    it('useSupervisorCommands usa polling adaptativo (90s sano / 20s degradado) en lugar de 12s fijo', () => {
        const src = fs.readFileSync(path.join(ROOT, 'src/hooks/useSupervisorCommands.js'), 'utf8');
        expect(src).toContain('HEALTHY_POLL_MS = 90000');
        expect(src).toContain('DEGRADED_POLL_MS = 20000');
        expect(src).not.toContain('}, 12000);');
    });
});
