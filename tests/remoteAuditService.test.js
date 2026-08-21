import { beforeEach, describe, expect, it, vi } from 'vitest';

const cloudState = vi.hoisted(() => ({
    rpc: vi.fn(),
    builder: null,
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        rpc: (...args) => cloudState.rpc(...args),
    },
}));

const cloudClient = {
    rpc: (...args) => cloudState.rpc(...args),
};

import {
    REMOTE_AUDIT_DOC_IDS,
    REMOTE_KARDEX_DOC_IDS,
    buildLocalRemoteBackup,
    buildRemoteBackup,
    extractRemoteKardexData,
    fetchRemoteDocuments,
    fetchRemoteEmployeePayrollDetail,
    fetchRemoteFullBackup,
    fetchRemoteInventoryAudit,
    fetchRemoteKardex,
} from '../src/services/remoteAuditService';

function configureQuery({ data = [], error = null } = {}) {
    const builder = {
        data,
        error,
    };

    cloudState.builder = builder;
    cloudState.rpc.mockClear();
    cloudState.rpc.mockResolvedValue({ data, error });

    return builder;
}

const pairedDeviceId = 'PDA-V2-TEST-001';

function remoteRow(docId, payload, collection = 'store', updatedAt = '2026-08-12T20:00:00.000Z') {
    return {
        collection,
        doc_id: docId,
        data: { payload },
        updated_at: updatedAt,
    };
}

function remoteDocument(docId, payload, collection = 'store', updatedAt = '2026-08-12T20:00:00.000Z') {
    return {
        collection,
        doc_id: docId,
        payload,
        updated_at: updatedAt,
    };
}

describe('remoteAuditService — lectura remota bajo demanda', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('dj_paired_device_id', pairedDeviceId);
        localStorage.setItem('dj_device_id', 'MONITOR-TEST-001');
        configureQuery();
    });

    it('REMOTE-001: consulta solo el dispositivo emparejado y proyecta columnas mínimas', async () => {
        configureQuery({
            data: [remoteRow('bodega_kardex_v1', [{ id: 'm1' }])],
        });

        const result = await fetchRemoteKardex(pairedDeviceId, cloudClient);

        expect(result.success).toBe(true);
        expect(cloudState.rpc).toHaveBeenCalledTimes(1);
        expect(cloudState.rpc).toHaveBeenCalledWith('read_paired_audit_documents', {
            p_primary_device_id: pairedDeviceId,
            p_monitor_device_id: 'MONITOR-TEST-001',
            p_doc_ids: [...REMOTE_KARDEX_DOC_IDS],
            p_updated_after: null,
        });
        expect(result.documents[0]).toMatchObject({
            doc_id: 'bodega_kardex_v1',
            payload: [{ id: 'm1' }],
        });
    });

    it('REMOTE-001B: auditoría incluye ventas y conserva la misma consulta única bajo demanda', async () => {
        configureQuery({
            data: [remoteRow('bodega_sales_v1', [{ id: 'sale-1' }])],
        });

        const result = await fetchRemoteInventoryAudit(pairedDeviceId, cloudClient);

        expect(result.success).toBe(true);
        expect(cloudState.rpc).toHaveBeenCalledWith('read_paired_audit_documents', {
            p_primary_device_id: pairedDeviceId,
            p_monitor_device_id: 'MONITOR-TEST-001',
            p_doc_ids: [...REMOTE_AUDIT_DOC_IDS],
            p_updated_after: null,
        });
        expect(cloudState.rpc).toHaveBeenCalledTimes(1);
    });

    it('REMOTE-002: rechaza otro dispositivo antes de generar tráfico', async () => {
        const result = await fetchRemoteKardex('PDA-V2-OTRO-999', cloudClient);

        expect(result).toMatchObject({
            success: false,
            error: { code: 'REMOTE_DEVICE_SCOPE_MISMATCH' },
        });
        expect(cloudState.rpc).not.toHaveBeenCalled();
    });

    it('REMOTE-003: rechaza documentos fuera de la whitelist', async () => {
        const result = await fetchRemoteDocuments(
            pairedDeviceId,
            ['secret_document'],
            cloudClient,
        );

        expect(result).toMatchObject({
            success: false,
            error: { code: 'REMOTE_DOC_ID_NOT_ALLOWED' },
            invalidDocIds: ['secret_document'],
        });
        expect(cloudState.rpc).not.toHaveBeenCalled();
    });

    it('REMOTE-004: devuelve errores RLS/red como resultado estructurado', async () => {
        configureQuery({ error: { code: '42501', message: 'row level security' } });

        const result = await fetchRemoteKardex(pairedDeviceId, cloudClient);

        expect(result).toEqual({
            success: false,
            error: { code: '42501', message: 'row level security' },
        });
    });

    it('REMOTE-005: informa documentos faltantes y fecha máxima recibida', async () => {
        configureQuery({
            data: [
                remoteRow('bodega_products_v1', [], 'store', '2026-08-12T20:00:00.000Z'),
                remoteRow('bodega_kardex_v1', [], 'store', '2026-08-12T21:00:00.000Z'),
            ],
        });

        const result = await fetchRemoteKardex(pairedDeviceId, cloudClient);

        expect(result.missingDocIds).toEqual([
            'bodega_kardex_snapshots_v1',
            'bodega_inventory_operations_v1',
        ]);
        expect(result.maxUpdatedAt).toBe('2026-08-12T21:00:00.000Z');
    });

    it('REMOTE-006: lee el snapshot completo por RPC y no consulta cloud_backups directamente', async () => {
        configureQuery({
            data: [{
                backup_data: {
                    metadata: { requestId: 'request-1', isComplete: true },
                    data: { idb: { bodega_products_v1: [] }, ls: {} },
                },
                updated_at: '2026-08-13T18:00:00.000Z',
            }],
        });

        const result = await fetchRemoteFullBackup(pairedDeviceId, cloudClient);

        expect(result.success).toBe(true);
        expect(result.backup.metadata.requestId).toBe('request-1');
        expect(result.updatedAt).toBe('2026-08-13T18:00:00.000Z');
        expect(cloudState.rpc).toHaveBeenCalledWith('read_paired_cloud_backup', {
            p_primary_device_id: pairedDeviceId,
            p_monitor_device_id: 'MONITOR-TEST-001',
            p_updated_after: null,
        });
    });

    it('REMOTE-007: solicita detalle de nómina solo para empleado y período válidos', async () => {
        configureQuery({
            data: [{
                consumptions: [{ id: 'cons-1', employeeId: 'e1', periodoId: '2026-08-17' }],
                settlements: [{ id: 'set-1', employeeId: 'e1', periodoId: '2026-08-17' }],
            }],
        });

        const result = await fetchRemoteEmployeePayrollDetail(
            pairedDeviceId,
            'e1',
            '2026-08-17',
            cloudClient,
        );

        expect(result).toMatchObject({
            success: true,
            employeeId: 'e1',
            periodoId: '2026-08-17',
            consumptions: [{ id: 'cons-1' }],
            settlements: [{ id: 'set-1' }],
        });
        expect(cloudState.rpc).toHaveBeenCalledWith('read_paired_employee_payroll_detail', {
            p_primary_device_id: pairedDeviceId,
            p_monitor_device_id: 'MONITOR-TEST-001',
            p_employee_id: 'e1',
            p_period_id: '2026-08-17',
        });
    });

    it('REMOTE-008: rechaza período inválido sin tocar la nube', async () => {
        const result = await fetchRemoteEmployeePayrollDetail(pairedDeviceId, 'e1', 'current', cloudClient);
        expect(result).toMatchObject({ success: false, error: { code: 'REMOTE_PAYROLL_PERIOD_INVALID' } });
        expect(cloudState.rpc).not.toHaveBeenCalled();
    });
});

describe('remoteAuditService — backup v2 en memoria', () => {
    it('BACKUP-000: la caja construye un snapshot completo con requestId y lista de faltantes', () => {
        const backup = buildLocalRemoteBackup(
            pairedDeviceId,
            'request-1',
            {
                bodega_products_v1: [],
                bodega_sales_v1: [],
                bodega_kardex_v1: [],
                bodega_kardex_snapshots_v1: [],
                bodega_inventory_operations_v1: [],
                bodega_sales_mirror_v1: [],
            },
            { business_name: 'Bodega Prueba', premium_token: 'no-debe-viajar' },
            '2026-08-13T18:00:00.000Z',
        );

        expect(backup.source).toBe('supervisor_full_backup_request');
        expect(backup.metadata.requestId).toBe('request-1');
        expect(backup.metadata.missingCriticalDocIds).toEqual([]);
        expect(backup.metadata.isReconciliationReady).toBe(true);
        expect(backup.metadata.isComplete).toBe(false);
        expect(backup.data.ls).toEqual({ business_name: 'Bodega Prueba' });
    });

    it('BACKUP-000B: el snapshot marca como crítico el soporte necesario para conciliación', () => {
        const backup = buildLocalRemoteBackup(pairedDeviceId, 'request-2', {
            bodega_products_v1: [],
            bodega_sales_v1: [],
            bodega_kardex_v1: [],
        }, {});

        expect(backup.metadata.missingCriticalDocIds).toEqual([
            'bodega_kardex_snapshots_v1',
            'bodega_inventory_operations_v1',
            'bodega_sales_mirror_v1',
        ]);
    });
});

describe('remoteAuditService — backup v2 en memoria', () => {
    it('BACKUP-001: construye backup v2 con datos IDB y local sin escribir storage', () => {
        const backup = buildRemoteBackup(
            pairedDeviceId,
            [
                remoteDocument('bodega_products_v1', [{ id: 'p1', stock: 327 }]),
                remoteDocument('bodega_sales_v1', [{ id: 's1' }]),
                remoteDocument('bodega_kardex_v1', [{ id: 'm1', cantidad: -1 }]),
                remoteDocument('bodega_kardex_snapshots_v1', [{ id: 'snap1' }]),
                remoteDocument('bodega_inventory_operations_v1', [{ operationId: 'op1' }]),
                remoteDocument('bodega_sales_mirror_v1', [{ id: 'mirror-1' }]),
                remoteDocument('business_name', 'Bodega Prueba', 'local'),
            ],
            '2026-08-12T22:00:00.000Z',
        );

        expect(backup).toMatchObject({
            version: '2.0',
            source: 'supervisor_remote_read',
            sourceDeviceId: pairedDeviceId,
            timestamp: '2026-08-12T22:00:00.000Z',
            data: {
                idb: {
                    bodega_products_v1: [{ id: 'p1', stock: 327 }],
                    bodega_sales_v1: [{ id: 's1' }],
                    bodega_kardex_v1: [{ id: 'm1', cantidad: -1 }],
                    bodega_inventory_operations_v1: [{ operationId: 'op1' }],
                },
                ls: { business_name: 'Bodega Prueba' },
            },
        });
        expect(backup.metadata.missingCriticalDocIds).toEqual([]);
        expect(backup.metadata.isReconciliationReady).toBe(true);
    });

    it('BACKUP-002: excluye el premium token y marca un backup incompleto', () => {
        const backup = buildRemoteBackup(pairedDeviceId, [
            remoteDocument('premium_token', 'sensitive-license-token', 'local'),
            remoteDocument('bodega_products_v1', []),
        ]);

        expect(backup.data.ls).not.toHaveProperty('premium_token');
        expect(backup.metadata.isComplete).toBe(false);
        expect(backup.metadata.missingCriticalDocIds).toEqual([
            'bodega_sales_v1',
            'bodega_kardex_v1',
            'bodega_kardex_snapshots_v1',
            'bodega_inventory_operations_v1',
            'bodega_sales_mirror_v1',
        ]);
    });

    it('BACKUP-003: serializa valores local no string como exige el importador v2', () => {
        const backup = buildRemoteBackup(pairedDeviceId, [
            remoteDocument('cop_enabled', true, 'local'),
            remoteDocument('tasa_cop', { value: 4150 }, 'local'),
        ]);

        expect(backup.data.ls).toEqual({
            cop_enabled: 'true',
            tasa_cop: '{"value":4150}',
        });
    });

    it('REMOTE-KDX-001: extrae datasets remotos sin alterar el storage del Supervisor', () => {
        const docs = [
            remoteDocument('bodega_products_v1', [{ id: 'p1', stock: 327 }]),
            remoteDocument('bodega_kardex_v1', [{ id: 'm1' }]),
            remoteDocument('bodega_kardex_snapshots_v1', [{ id: 'snap1' }]),
            remoteDocument('bodega_inventory_operations_v1', [{ operationId: 'op1' }]),
        ];

        const result = extractRemoteKardexData(docs);

        expect(result).toEqual({
            products: [{ id: 'p1', stock: 327 }],
            sales: [],
            kardex: [{ id: 'm1' }],
            snapshots: [{ id: 'snap1' }],
            operations: [{ operationId: 'op1' }],
            missingDocIds: [],
        });
        expect(localStorage.getItem('bodega_kardex_v1')).toBeNull();
    });
});
