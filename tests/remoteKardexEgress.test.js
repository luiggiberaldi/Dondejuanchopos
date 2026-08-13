import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const panelSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/Monitor/RemoteKardexPanel.jsx'),
    'utf8',
);
const monitorSource = fs.readFileSync(
    path.resolve(__dirname, '../src/hooks/useMonitorSync.js'),
    'utf8',
);
const serviceSource = fs.readFileSync(
    path.resolve(__dirname, '../src/services/remoteAuditService.js'),
    'utf8',
);
const ownerSource = fs.readFileSync(
    path.resolve(__dirname, '../src/views/OwnerMonitorView.jsx'),
    'utf8',
);
const sqlSource = fs.readFileSync(
    path.resolve(__dirname, '../supabase_remote_audit_setup.sql'),
    'utf8',
);

describe('Supervisor remote Kardex — egress y seguridad', () => {
    it('EGRESS-REMOTE-001: montar el panel no dispara una lectura automática', () => {
        expect(panelSource).not.toContain('useEffect(');
        expect(panelSource).toContain('onClick={loadAudit}');
    });

    it('EGRESS-REMOTE-002: cada refresh manual usa el servicio de auditoría bajo demanda', () => {
        expect(panelSource).toContain('fetchRemoteInventoryAudit(deviceId)');
        expect(panelSource).toContain('if (loading || !deviceId) return;');
        expect(serviceSource).toContain("rpc('read_paired_audit_documents'");
        expect(serviceSource).toContain('p_primary_device_id: deviceId');
    });

    it('EGRESS-REMOTE-003: el pull del monitor no consulta sync_documents directamente', () => {
        expect(monitorSource).toContain('fetchRemoteDocuments');
        expect(monitorSource).toContain('REMOTE_MONITOR_DOC_IDS');
        expect(monitorSource).not.toContain(".from('sync_documents')");
    });

    it('EGRESS-REMOTE-004: Kardex no se agrega al sync permanente del monitor', () => {
        const monitorDocsBlock = monitorSource.slice(
            monitorSource.indexOf('const MONITOR_DOC_IDS'),
            monitorSource.indexOf('];', monitorSource.indexOf('const MONITOR_DOC_IDS')) + 2,
        );
        expect(monitorDocsBlock).not.toContain('bodega_kardex_v1');
        expect(monitorDocsBlock).not.toContain('bodega_inventory_operations_v1');
    });

    it('EGRESS-REMOTE-005: el panel no publica ni persiste la lectura remota', () => {
        expect(panelSource).not.toMatch(/queueCloudSync|forceSyncAllPOSData|localforage|storageService\.(setItem|getItem)/);
    });

    it('UI-REMOTE-006: el Kardex remoto queda oculto temporalmente del Supervisor', () => {
        expect(ownerSource).not.toContain("setViewTab('kardex')");
        expect(ownerSource).not.toMatch(/<RemoteKardexPanel\b/);
        expect(ownerSource).not.toContain('grid grid-cols-7 sm:flex');
    });

    it('RLS-REMOTE-001: la lectura de producción exige pairing exacto, cursor y whitelist SQL', () => {
        expect(serviceSource).toContain("rpc('read_paired_audit_documents'");
        expect(sqlSource).toContain('pairing.primary_device_id = p_primary_device_id');
        expect(sqlSource).toContain('pairing.monitor_device_id = p_monitor_device_id');
        expect(sqlSource).toContain('monitor.primary_device_id = p_primary_device_id');
        expect(sqlSource).toContain('monitor.monitor_device_id = p_monitor_device_id');
        expect(sqlSource).toContain('monitor.revoked_at IS NULL');
        expect(sqlSource).toContain('p_updated_after TIMESTAMPTZ DEFAULT NULL');
        expect(sqlSource).toContain('document.updated_at > p_updated_after');
        expect(sqlSource).toContain("'bodega_kardex_v1'");
        expect(sqlSource).toContain("'bodega_sales_v1'");
        expect(sqlSource).toContain("'business_name'");
        expect(sqlSource).not.toContain("'premium_token'");
        expect(sqlSource).toContain("REVOKE SELECT ON public.sync_documents FROM anon");
    });
});
