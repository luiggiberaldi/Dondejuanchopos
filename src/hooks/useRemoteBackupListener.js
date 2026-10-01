import { useEffect, useRef } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { storageService } from '../utils/storageService';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { compressString, isCompressionSupported } from '../utils/compression';
import { runCloudUploadWithBackoff } from '../utils/cloudRetry';

async function collectAndUpload(deviceId) {
    // Recolectar datos locales
    // HOOK-041: usa las listas canónicas de backupKeys.js.
    const idbData = {};
    for (const key of IDB_KEYS) {
        const data = await storageService.getItem(key, null);
        if (data !== null) idbData[key] = data;
    }
    const lsData = {};
    for (const key of LS_KEYS) {
        const val = localStorage.getItem(key);
        if (val !== null) lsData[key] = val;
    }
    const backupData = {
        timestamp: new Date().toISOString(),
        version: '2.0',
        appName: 'TasasAlDia_Bodegas_Cloud',
        data: { idb: idbData, ls: lsData }
    };

    let payloadToUpload = backupData;
    if (isCompressionSupported()) {
        try {
            const compressedData = await compressString(JSON.stringify(backupData));
            payloadToUpload = {
                compressed: true,
                version: '2.0',
                timestamp: backupData.timestamp,
                appName: backupData.appName,
                data: compressedData
            };
        } catch (err) {
            console.error('[RemoteBackup] Error compressing remote backup:', err);
        }
    }

    // Subir a cloud_backups. Un 401/RLS/schema mismatch no debe repetirse
    // cada vez que realtime vuelva a anunciar la misma solicitud pendiente.
    const uploadResult = await runCloudUploadWithBackoff(`remote-backup:${deviceId}`, () =>
        supabaseCloud
            .from('cloud_backups')
            .upsert({ device_id: deviceId, backup_data: payloadToUpload, updated_at: new Date().toISOString() },
                { onConflict: 'device_id' }),
    );
    if (!uploadResult.success) {                const uploadError = uploadResult.error || new Error(`Subida pausada por backoff (${Math.ceil(uploadResult.retryInMs / 1000)}s).`);
                uploadError.retryInMs = uploadResult.retryInMs;
                throw uploadError;

    }
}

/**
 * Escucha solicitudes de backup remoto desde la Estación Maestra.
 * Cuando llega una solicitud (status='pending'), sube el backup y la marca como completada.
 */
export function useRemoteBackupListener(deviceId) {
    useEffect(() => {
        if (!supabaseCloud || !deviceId) return;

        const handleRequest = async () => {
            if (requestInFlight) return;
            requestInFlight = true;
            try {
                await collectAndUpload(deviceId);
                const { error } = await supabaseCloud
                    .from('backup_requests')
                    .update({ status: 'completed', completed_at: new Date().toISOString() })
                    .eq('device_id', deviceId);
                if (error) throw error;
                console.log('[RemoteBackup] Backup enviado al admin.');
            } catch (err) {
                console.error('[RemoteBackup] Error al responder solicitud:', err);
                // Mantener la solicitud pendiente para que recupere el backup; el backoff
                // persistente evita retries inmediatos también si la app se reinicia.
                const retryInMs = Math.max(Number(err?.retryInMs) || 0, 15_000);
                if (retryTimer) clearTimeout(retryTimer);
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    if (!disposed) handleRequest();
                }, retryInMs);
            } finally {
                requestInFlight = false;
            }
        };

        let channel = null;
        let requestInFlight = false;
        let retryTimer = null;
        let disposed = false;

        // Verificar si hay una solicitud pendiente al conectar
        supabaseCloud
            .from('backup_requests')
            .select('status')
            .eq('device_id', deviceId)
            .single()
            .then(({ data }) => { if (data?.status === 'pending') handleRequest(); })
            .catch(() => {});

        // Suscribirse a nuevas solicitudes en tiempo real de forma anónima
        channel = supabaseCloud
            .channel(`remote_backup:${deviceId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'backup_requests',
                filter: `device_id=eq.${deviceId}`,
            }, async (payload) => {
                if (payload.new?.status === 'pending') await handleRequest();
            })
            .subscribe();

        return () => {
            disposed = true;
            if (retryTimer) clearTimeout(retryTimer);
            if (channel) {
                supabaseCloud.removeChannel(channel).catch(() => {});
            }
        };
    }, [deviceId]);
}
