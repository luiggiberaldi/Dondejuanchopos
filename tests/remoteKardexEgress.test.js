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
const cloudSyncSource = fs.readFileSync(
    path.resolve(__dirname, '../src/hooks/useCloudSync.js'),
    'utf8',
);
const pairingScanSource = fs.readFileSync(
    path.resolve(__dirname, '../src/components/PairingScanScreen.jsx'),
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

    it('UI-REMOTE-006: el Kardex remoto está disponible en el Supervisor bajo demanda', () => {
        expect(ownerSource).toContain("setViewTab('kardex')");
        expect(ownerSource).toMatch(/<RemoteKardexPanel\b/);
        expect(ownerSource).toContain('grid grid-cols-8 sm:flex');
    });

    it('PRESENCE-REMOTE-001: el heartbeat de la caja no queda bloqueado por CloudSync/Auth', () => {
        const start = cloudSyncSource.indexOf('const pingPosPresence');
        const end = cloudSyncSource.indexOf('const presenceIntervalId', start);
        const heartbeatBlock = cloudSyncSource.slice(start, end);

        expect(heartbeatBlock).toContain('if (!navigator.onLine || !deviceId) return;');
        expect(heartbeatBlock).toContain("rpc('touch_pos_heartbeat'");
        expect(heartbeatBlock).not.toContain('navigator.onLine && isCloudSyncActive && deviceId');
        expect(heartbeatBlock).toContain('isCloudSyncActive && hb && hb.registered === false');
        expect(cloudSyncSource).toContain("document.addEventListener('visibilitychange', handlePresenceVisibility)");
    });

    it('PRESENCE-REMOTE-002: un fallo de presencia no se presenta como caja offline confirmada', () => {
        expect(monitorSource).toContain('presenceError');
        expect(ownerSource).toContain("presenceError ? 'Caja: Sin verificar' : 'Caja: Offline'");
    });

    it('PAIRING-REMOTE-003: un dispositivo que fue caja recibe una identidad nueva al reemparejarse', () => {
        expect(pairingScanSource).toContain("const needsFreshMonitorId = !monitorId || isRetry || !monitorId.startsWith('mon_');");
        expect(pairingScanSource).toContain('if (needsFreshMonitorId)');
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
        expect(sqlSource).toContain('CREATE OR REPLACE FUNCTION public.read_paired_cloud_backup');
        expect(sqlSource).toContain('REMOTE_BACKUP_PAIRING_REQUIRED');
        expect(sqlSource).toContain('GRANT EXECUTE ON FUNCTION public.read_paired_cloud_backup');
    });

    it('BACKUP-REMOTE-008: el backup completo se captura en la caja mediante un comando autorizado', () => {
        const commandsSource = fs.readFileSync(
            path.resolve(__dirname, '../src/hooks/useSupervisorCommands.js'),
            'utf8',
        );

        expect(ownerSource).toContain("command_type: 'request_full_backup'");
        expect(commandsSource).toContain("command.command_type === 'request_full_backup'");
        expect(commandsSource).toContain("rpc('write_paired_cloud_backup'");
        expect(commandsSource).toContain('buildLocalRemoteBackup');
        expect(commandsSource).toContain("withLock('pos_write_lock'");
        expect(commandsSource).toContain('REMOTE_BACKUP_EXCLUDED_KEYS');
        expect(sqlSource).toContain("'request_full_backup'");
        expect(sqlSource).toContain('CREATE OR REPLACE FUNCTION public.write_paired_cloud_backup');
        expect(sqlSource).toContain('REMOTE_BACKUP_REQUEST_INVALID');
        expect(sqlSource).toContain('REVOKE ALL ON public.cloud_backups FROM anon');
    });

    it('EGRESS-REMOTE-007: la caja escribe por RPC whitelistado y no por CRUD directo', () => {
        expect(cloudSyncSource).toContain("rpc('write_paired_sync_document'");
        expect(cloudSyncSource).not.toContain(".from('sync_documents').upsert");
        expect(cloudSyncSource).toContain('p_collection: collectionType');
        expect(cloudSyncSource).toContain('p_doc_id: key');
        expect(cloudSyncSource).toContain('if (session && session.user?.id !== activeDeviceId)');
        expect(sqlSource).toContain('CREATE OR REPLACE FUNCTION public.write_paired_sync_document');
        expect(sqlSource).toContain('POS_SYNC_DEVICE_NOT_REGISTERED');
        expect(sqlSource).toContain("REVOKE INSERT, UPDATE, DELETE ON public.sync_documents FROM anon");
        expect(sqlSource).toContain('GRANT EXECUTE ON FUNCTION public.write_paired_sync_document');
    });
});
