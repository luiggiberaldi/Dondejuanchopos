import { useState } from 'react';
import localforage from 'localforage';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { supabaseCloud } from '../config/supabaseCloud';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { runWithoutEco } from '../utils/syncFlags';
import { compressString, decompressString, isCompressionSupported } from '../utils/compression';
import { uploadProductImage } from '../utils/imageUpload';
import { mergeMissingProductImages } from '../utils/productImageRecovery';


/**
 * Hook that encapsulates cloud backup/restore logic using device_id as the sole identifier.
 * No email or password required.
 *
 * @param {Object} params
 * @param {string}   params.deviceId
 * @param {Function} params.auditLog
 * @param {Function} params.forceHeartbeat
 * @param {Function} [params.triggerHaptic]
 */
export function useCloudBackup({
    deviceId,
    auditLog,
    forceHeartbeat,
    triggerHaptic,
}) {
    const [importStatus, setImportStatus] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [dataConflictPending, setDataConflictPending] = useState(null);

    // ─── HELPER: Apply a cloud backup to local storage ───────────────────────
    // HOOK-014: Envolver TODA la restauración en `runWithoutEco` para setear
    // el flag `isSyncingFromCloud=true` y evitar que `storageService.setItem`
    // (vía `pushCloudSync`) re-envíe a la nube los datos que acabamos de recibir.
    const applyCloudBackup = async (cloudBackup) => {
        let backup = cloudBackup;
        if (cloudBackup?.compressed) {
            try {
                const rawJson = await decompressString(cloudBackup.data);
                backup = JSON.parse(rawJson);
            } catch (err) {
                console.error('[applyCloudBackup] Error al descomprimir:', err);
                throw new Error('El backup de la nube está dañado o no pudo descomprirse.');
            }
        }

        if (!backup?.data) {
            console.error('[applyCloudBackup] Backup inválido o sin datos:', backup);
            throw new Error('El backup de la nube está vacío o es inválido.');
        }
        await runWithoutEco(async () => {
            if (backup.version === '2.0' && backup.data.idb) {
                const idbEntries = Object.entries(backup.data.idb);
                for (const [key, value] of idbEntries) {
                    await storageService.setItem(key, value);
                }
            } else {
                console.warn('[applyCloudBackup] Formato no reconocido, intentando restauración legacy...');
            }
            if (backup.data.ls) {
                // D7: el interceptor de localStorage.setItem fue eliminado en
                // SEC-009/HOOK-011; el comentario anterior describía un mecanismo
                // que ya no existe. Escribir aquí NO republicaba nada, así que tras
                // restaurar un backup el monitor conservaba el estado anterior.
                for (const [key, value] of Object.entries(backup.data.ls)) {
                    localStorage.setItem(key, value);
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key } }));
                }
            }
        });

        // D7: la restauración es un cambio de estado legítimo que DEBE propagarse
        // a los monitores. Se hace fuera de runWithoutEco (el anti-eco solo debe
        // cubrir la escritura, no la publicación) y de forma incondicional, porque
        // los hashes de egress corresponden al estado previo a la restauración.
        try {
            const { forceSyncAllPOSData } = await import('./useCloudSync');
            await forceSyncAllPOSData(undefined, true);
        } catch (e) {
            console.warn('[applyCloudBackup] No se pudo republicar tras la restauración:', e);
        }
    };

    /**
     * Recupera únicamente `image` por id. Nunca reemplaza el catálogo completo,
     * nunca elimina productos y no publica el resultado automáticamente: así
     * una foto Base64 recuperada no puede volver a ser eliminada por el sync
     * cloud antes de que el usuario valide el resultado.
     */
    const recoverProductImagesOnly = async () => {
        const currentProducts = await storageService.getItem('bodega_products_v1', []);
        if (!Array.isArray(currentProducts)) {
            return { recovered: 0, uploaded: 0, source: null, updatedProducts: [] };
        }

        const sources = [];
        const sourceLabels = [];
        const shadow = await localforage.getItem('bodega_products_shadow_backup_v1');
        if (Array.isArray(shadow)) {
            sources.push(shadow);
            sourceLabels.push('copia de sombra local');
        }

        if (supabaseCloud && deviceId) {
            try {
                const { data: cloudRow, error } = await supabaseCloud
                    .from('cloud_backups')
                    .select('backup_data')
                    .eq('device_id', deviceId)
                    .maybeSingle();
                if (error) throw error;

                let backup = cloudRow?.backup_data;
                if (backup?.compressed) {
                    backup = JSON.parse(await decompressString(backup.data));
                }
                const cloudProducts = backup?.data?.idb?.bodega_products_v1;
                if (Array.isArray(cloudProducts)) {
                    sources.push(cloudProducts);
                    sourceLabels.push('backup cloud');
                }
            } catch (error) {
                console.warn('[CloudBackup] No se pudo consultar backup para recuperar imágenes:', error);
            }
        }

        // Última fuente de recuperación: Storage. Las imágenes migradas se
        // guardan como `${deviceId}/${productId}.ext`, por lo que podemos
        // reconstruir únicamente las referencias de los productos actuales
        // sin descargar ni modificar el catálogo completo.
        if (supabaseCloud && Array.isArray(currentProducts)) {
            const currentIds = new Set(currentProducts.map(product => product?.id).filter(Boolean));
            const prefixes = [...new Set([
                deviceId,
                localStorage.getItem('dj_paired_device_id'),
                localStorage.getItem('dj_device_id'),
            ].filter(Boolean).map(value => String(value).replace(/[^a-zA-Z0-9_-]/g, '_')))];
            const storageProducts = [];

            for (const prefix of prefixes) {
                try {
                    const { data: objects, error } = await supabaseCloud.storage
                        .from('product-images')
                        .list(prefix, { limit: 1000 });
                    if (error) continue;

                    for (const object of objects || []) {
                        if (!object?.name || object.name.includes('/')) continue;
                        const productId = object.name.replace(/\.[^.]+$/, '');
                        if (!currentIds.has(productId)) continue;
                        const path = `${prefix}/${object.name}`;
                        const { data: publicData } = supabaseCloud.storage
                            .from('product-images')
                            .getPublicUrl(path);
                        if (publicData?.publicUrl) {
                            storageProducts.push({ id: productId, image: publicData.publicUrl });
                        }
                    }
                } catch (error) {
                    console.warn('[CloudBackup] No se pudo inspeccionar Storage para recuperar imágenes:', error);
                }
            }

            if (storageProducts.length > 0) {
                sources.push(storageProducts);
                sourceLabels.push('Supabase Storage');
            }
        }

        const merged = mergeMissingProductImages(currentProducts, ...sources);
        if (merged.recovered === 0) {
            return { recovered: 0, uploaded: 0, source: null, updatedProducts: currentProducts };
        }

        let uploaded = 0;
        const updatedProducts = merged.products.map(product => ({ ...product }));
        for (const productId of merged.recoveredIds) {
            const product = updatedProducts.find(item => item.id === productId);
            if (!product || typeof product.image !== 'string' || !product.image.startsWith('data:')) continue;
            const url = await uploadProductImage(product.image, { id: product.id });
            if (url) {
                product.image = url;
                uploaded++;
            }
        }

        // Escritura directa: solo cambia las propiedades image recuperadas y no
        // dispara una publicación cloud potencialmente incompleta.
        await localforage.setItem('bodega_products_v1', updatedProducts);
        window.dispatchEvent(new CustomEvent('app_storage_update', {
            detail: { key: 'bodega_products_v1', source: 'image-recovery', payload: updatedProducts }
        }));

        return {
            recovered: merged.recovered,
            uploaded,
            source: sourceLabels.join(' + ') || 'fuente local',
            updatedProducts,
        };
    };

    // ─── HELPER: Collect local backup payload ────────────────────────────────
    // HOOK-041: Usa las listas canónicas de `src/config/backupKeys.js`.
    const collectLocalBackup = async () => {
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
        return {
            timestamp: new Date().toISOString(),
            version: '2.0',
            appName: 'TasasAlDia_Bodegas_Cloud',
            data: { idb: idbData, ls: lsData }
        };
    };

    // ─── HELPER: Upload local backup + initialize sync_documents ─────────────
    const uploadLocalBackup = async (backupData) => {
        if (!supabaseCloud || !deviceId) return;

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
                console.error('[CloudBackup] Error al comprimir manual backup, usando raw JSON:', err);
            }
        }

        // 1. Backup blob completo
        const { error } = await supabaseCloud
            .from('cloud_backups')
            .upsert({
                device_id: deviceId,
                backup_data: payloadToUpload,
                updated_at: new Date().toISOString()
            }, { onConflict: 'device_id' });
        if (error) throw error;

        // 2. Inyección inicial en sync_documents para P2P
        try {
            const syncPayloads = [];
            for (const [key, value] of Object.entries(backupData.data.idb || {})) {
                syncPayloads.push({
                    device_id: deviceId,
                    collection: 'store',
                    doc_id: key,
                    data: { payload: value }
                });
            }
            for (const [key, value] of Object.entries(backupData.data.ls || {})) {
                let finalVal = value;
                try { finalVal = JSON.parse(value); } catch { /* keep as string */ }
                syncPayloads.push({
                    device_id: deviceId,
                    collection: 'local',
                    doc_id: key,
                    data: { payload: finalVal }
                });
            }
            if (syncPayloads.length > 0) {
                await supabaseCloud.from('sync_documents').upsert(syncPayloads, { onConflict: 'device_id,collection,doc_id' });
            }
        } catch (syncErr) {
            console.warn('[CloudBackup] Fallo inicializando sync_documents:', syncErr);
        }
    };

    // ─── HANDLER: Data conflict resolution ───────────────────────────────────
    const handleDataConflictChoice = async (choice) => {
        if (!dataConflictPending) return;
        const { cloudBackup, localBackup } = dataConflictPending;
        setDataConflictPending(null);
        setImportStatus('loading');
        setStatusMessage('Aplicando tu elección...');
        try {
            if (choice === 'cloud') {
                await applyCloudBackup(cloudBackup);
                showToast('Datos de la nube restaurados. Reiniciando...', 'success');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                await uploadLocalBackup(localBackup);
                showToast('Datos locales guardados en la nube', 'success');
            }
            auditLog('NUBE', 'CONFLICTO_RESUELTO', `Conflicto datos resuelto: usuario eligió ${choice}`);
            setImportStatus(null);
        } catch (err) {
            showToast(err.message || 'Error al resolver el conflicto', 'error');
            setImportStatus('error');
        }
    };

    // ─── HANDLER: Sync cloud (initial connect) ────────────────────────────────
    const handleSyncCloud = async () => {
        if (!supabaseCloud || !deviceId) {
            showToast('Sin conexión a la nube', 'error');
            return;
        }

        try {
            setImportStatus('loading');
            setStatusMessage('Consultando backup en la nube...');

            const { data: cloudRow } = await supabaseCloud
                .from('cloud_backups')
                .select('backup_data')
                .eq('device_id', deviceId)
                .maybeSingle();

            const cloudBackup = cloudRow?.backup_data || null;
            const localBackup = await collectLocalBackup();
            const hasLocalData = Object.keys(localBackup.data.idb).length > 0;
            const hasCloudData = cloudBackup && cloudBackup.data;

            if (hasCloudData && hasLocalData) {
                // ⚠️ Conflicto: ambos tienen datos → preguntar al usuario
                setDataConflictPending({ cloudBackup, localBackup });
                setImportStatus(null);
                setStatusMessage('');
                auditLog('NUBE', 'CONFLICTO_DETECTADO', 'Conflicto datos nube/local');
                return;
            }

            if (hasCloudData && !hasLocalData) {
                // Dispositivo vacío → restaurar desde nube
                setStatusMessage('Restaurando backup de la nube...');
                await applyCloudBackup(cloudBackup);
                showToast('Datos restaurados automáticamente desde la nube', 'success');
                auditLog('NUBE', 'RESTORE_AUTO', 'Backup restaurado automáticamente');
                triggerHaptic?.();
                setImportStatus('success');
                setStatusMessage('Restauración completa. Reiniciando...');
                setTimeout(() => window.location.reload(), 1500);
                return;
            }

            // Sin datos en la nube → subir datos locales
            setStatusMessage('Guardando datos locales en la nube...');
            await uploadLocalBackup(localBackup);
            showToast('Datos sincronizados con la nube', 'success');
            auditLog('NUBE', 'SYNC_INICIAL', 'Datos locales subidos a la nube');
            triggerHaptic?.();
            setImportStatus(null);

        } catch (error) {
            console.error('[CloudBackup] Error:', error);
            showToast(error.message || 'Error contactando la nube', 'error');
            setImportStatus('error');
        }
    };

    return {
        importStatus,
        setImportStatus,
        statusMessage,
        setStatusMessage,
        dataConflictPending,
        setDataConflictPending,
        applyCloudBackup,
        collectLocalBackup,
        uploadLocalBackup,
        handleSyncCloud,
        handleDataConflictChoice,
        recoverProductImagesOnly,
    };
}
