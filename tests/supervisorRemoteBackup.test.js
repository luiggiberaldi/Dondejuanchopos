import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
    path.resolve(__dirname, '../src/views/OwnerMonitorView.jsx'),
    'utf8',
);
const SETTINGS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../src/views/SettingsView.jsx'),
    'utf8',
);
const SYSTEM_SETTINGS_SRC = fs.readFileSync(
    path.resolve(__dirname, '../src/components/Settings/tabs/SettingsTabSistema.jsx'),
    'utf8',
);

function getBackupHandlerBody() {
    const start = SRC.indexOf('const handleDownloadRemoteBackup');
    const end = SRC.indexOf('// «Subir al sistema»', start);
    return SRC.slice(start, end);
}

describe('Supervisor — descarga de backup remoto v2', () => {
    it('BACKUP-UI-001: usa el servicio remoto y la whitelist canónica', () => {
        const body = getBackupHandlerBody();

        expect(SRC).toContain("from '../services/remoteAuditService'");
        expect(SRC).toContain('fetchRemoteFullBackup');
        expect(body).toContain("command_type: 'request_full_backup'");
        expect(body).toContain('fetchRemoteFullBackup(pairedDeviceId)');
        expect(body).not.toContain('fetchRemoteDocuments(pairedDeviceId');
    });

    it('BACKUP-UI-002: solicita el snapshot a la caja, espera el requestId y genera un archivo descargable', () => {
        const body = getBackupHandlerBody();

        expect(body).toContain("new Blob([JSON.stringify(backup, null, 2)]");
        expect(body).toContain('anchor.download');
        expect(body).toContain("const suffix = isPartial ? 'parcial' : 'completo'");
        expect(body).toContain('missingCriticalDocIds');
        expect(body).toContain('result.backup?.metadata?.requestId === requestId');
    });

    it('BACKUP-UI-003: la lectura final no publica ni persiste el backup remoto', () => {
        const body = getBackupHandlerBody();

        expect(body).not.toMatch(/forceSyncAllPOSData|queueCloudSync|storageService\.setItem|localforage/);
    });

    it('BACKUP-UI-004: expone la acción en menú móvil y escritorio', () => {
        expect(SRC).toContain('Descargar backup de la caja');
        expect(SRC).toContain('title="Descargar backup de la caja"');
        expect(SRC.match(/handleDownloadRemoteBackup/g)?.length).toBeGreaterThanOrEqual(3);
    });

    it('MAINTENANCE-UI-001: oculta la recuperación de fotos en todas las interfaces', () => {
        for (const source of [SRC, SETTINGS_SRC, SYSTEM_SETTINGS_SRC]) {
            expect(source).not.toContain('Recuperar solo fotos');
            expect(source).not.toContain('recoverProductImagesOnly');
            expect(source).not.toContain('recoveringImages');
        }
    });
});
