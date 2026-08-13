import { useEffect, useRef } from 'react';
import localforage from 'localforage';
import { supabaseCloud } from '../config/supabaseCloud';
import { useAuthStore } from './store/useAuthStore';
import { useSupervisorCommands } from './useSupervisorCommands';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { registerCloudSyncSetter } from '../utils/syncFlags';
import { createAsyncKeyQueue } from '../utils/asyncKeyQueue';
import { mergeCloudProductImages } from '../utils/productImageRecovery';

// EGRESS: claves que se respaldan pero NO se sincronizan a la nube.
// Cada upsert a sync_documents se retransmite por Realtime a CADA monitor
// conectado, así que sincronizar algo que el monitor no lee es egress puro.
//   • bodega_sales_mirror_v1 → duplicado casi exacto de bodega_sales_v1
//     (blindaje anti-pérdida LOCAL, ver checkoutProcessor.js). El monitor
//     nunca lo lee; sigue incluido en los backups vía IDB_KEYS.
//   • abasto_audit_log_v1 → hasta 15.000 entradas (auditService MAX_ENTRIES),
//     reescrito en cada evento auditado. El monitor no lo renderiza.
const CLOUD_SYNC_EXCLUDE = ['bodega_sales_mirror_v1', 'abasto_audit_log_v1', 'bodega_pos_heartbeat'];

// Unión de catálogos canónicos más bodega_rate_mode y bodega_users_catalog_v1 (excluyendo claves no sincronizables)
const SYNC_KEYS = [...new Set([...IDB_KEYS, ...LS_KEYS, 'bodega_rate_mode', 'bodega_users_catalog_v1'])].filter(k => !CLOUD_SYNC_EXCLUDE.includes(k));

// LOCAL_KEYS determina qué se guarda como collection='local' en sync_documents
const LOCAL_KEYS = [...new Set([...LS_KEYS, 'bodega_rate_mode', 'bodega_users_catalog_v1'])].filter(k => !CLOUD_SYNC_EXCLUDE.includes(k));

/** Hash ligero para detectar cambios sin comparar objetos enteros (mismo patrón que useAutoBackup.js) */
function quickHash(value) {
    const str = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    const len = str.length;
    if (len === 0) return '0_0';
    let h = 0;
    const step = Math.max(1, Math.floor(len / 5000));
    for (let i = 0; i < len; i += step) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return `${len}_${h >>> 0}`;
}

const LAST_PUSH_HASH_PREFIX = 'bodega_last_periodic_push_hash_';

// ─── Estado Global del Motor ───────────────────────────────────────────────
let globalSubscription = null;
let isSyncingFromCloud = false; // true mientras aplicamos cambios de la nube → evita eco

// D7: conectar la bandera local del módulo con `runWithoutEco` de syncFlags.
// Sin este registro había DOS banderas anti-eco independientes: la de este
// módulo y la de syncFlags.js, y `runWithoutEco` no silenciaba a esta.
// La única llamada existente estaba en tests/hooks.test.js — nunca en producción.
registerCloudSyncSetter((v) => { isSyncingFromCloud = v; });

let pendingPush = {};           // Debounce: { [key]: timeoutId }
const serializedCloudPush = createAsyncKeyQueue();
let _currentDeviceId = '';      // Device ID activo para pushCloudSync
let isCloudSyncActive = false;   // Evita empujar a la nube si el dispositivo no está autenticado/emparejado
let gateRetryTimer = null;

// SEC-009 / HOOK-011: ELIMINADO el monkeypatch global de `localStorage.setItem`.
// Antes se reemplazaba `localStorage.setItem` a nivel módulo, interceptando TODAS
// las escrituras (incluyendo extensiones y devtools) y empujando a sync_documents.
// Eso causaba:
//   1. Recursión si el módulo se importa dos veces (HMR, tests).
//   2. Filtrado de hashes de PIN a una tabla pública (SEC-002).
//
// Ahora, los puntos de escritura explícitos llaman a `storageService.setItem` (que
// invoca `pushCloudSync` internamente). Para localStorage writes directos, los
// callers deben usar `pushLocalSync(key, value)` explícitamente.
//
// Mantenemos `originalSetItem` como referencia interna solo para aplicar cambios
// venidos de la nube sin disparar re-eco.

const originalSetItem = localStorage.setItem.bind(localStorage);

// Keys pesadas (arrays grandes con imágenes) usan debounce más largo para agrupar ediciones
const HEAVY_KEYS = ['bodega_products_v1', 'bodega_customers_v1', 'abasto_audit_log_v1'];
const DEBOUNCE_LIGHT_MS = 300;
const DEBOUNCE_HEAVY_MS = 2000;

function _debouncePush(key, value) {
    if (pendingPush[key]) clearTimeout(pendingPush[key]);
    const delay = HEAVY_KEYS.includes(key) ? DEBOUNCE_HEAVY_MS : DEBOUNCE_LIGHT_MS;
    pendingPush[key] = setTimeout(() => {
        delete pendingPush[key];
        pushCloudSync(key, value).catch(() => {});
    }, delay);
}

function sanitizePayloadForSync(key, value) {
    if (key === 'bodega_products_v1' && Array.isArray(value)) {
        return value.map(p => {
            if (p && typeof p.image === 'string' && p.image.startsWith('data:')) {
                const { image, ...rest } = p;
                return rest;
            }
            return p;
        });
    }
    return value;
}

async function getCloudSession() {
    if (!supabaseCloud?.auth?.getSession) return null;
    try {
        const { data, error } = await supabaseCloud.auth.getSession();
        const session = data?.session;
        if (error || !session) return null;
        if (session.expires_at && session.expires_at * 1000 < Date.now()) return null;
        return session;
    } catch {
        return null;
    }
}

const pushCloudSyncNow = async (key, value, forceUnconditional = false) => {
    if (!supabaseCloud) return false;
    if (isSyncingFromCloud) return false;          // Nunca re-emitir lo que llegó de la nube
    const isMonitor = localStorage.getItem('dj_pairing_mode') === 'monitor';
    if (isMonitor) return false;                  // Omitir si este dispositivo es un Monitor visor
    if (!isCloudSyncActive) return false;          // Omitir si el dispositivo no está autenticado o emparejado en la nube

    if (!SYNC_KEYS.includes(key)) return false;
    const activeDeviceId = _currentDeviceId || localStorage.getItem('dj_device_id');
    if (!activeDeviceId) return false;

    // El POS funciona sin una sesión Auth de Supabase. La autorización de
    // escritura la aplica el RPC por pairing y whitelist; si existe una sesión,
    // nunca permitimos que una identidad distinta escriba documentos de la caja.
    const session = await getCloudSession();
    if (session && session.user?.id !== activeDeviceId) {
        isCloudSyncActive = false;
        return false;
    }

    // SEC-002: jamás empujar `abasto-auth-storage` aunque accidentalmente lo pidan.
    if (key === 'abasto-auth-storage') return false;

    const payloadToUpload = sanitizePayloadForSync(key, value);

    // E2: tope duro de egress por documento. No trunca ni recorta datos — solo
    // rechaza y avisa, para que un documento desbocado sea visible en vez de
    // convertirse en una factura sorpresa. 2 MB está muy por encima del mayor
    // documento real observado (~1.1 MB para el dataset completo).
    const MAX_DOC_BYTES = 2 * 1024 * 1024;
    try {
        const approxBytes = JSON.stringify(payloadToUpload)?.length ?? 0;
        if (approxBytes > MAX_DOC_BYTES) {
            console.error(
                `[CloudSync] E2: documento '${key}' de ${(approxBytes / 1048576).toFixed(2)} MB ` +
                `supera el tope de ${MAX_DOC_BYTES / 1048576} MB. NO se sube. ` +
                `Revisa por qué creció (¿histórico sin podar?).`
            );
            return false;
        }
    } catch {
        // Si no es serializable, que falle el upsert y lo reporte por el camino normal.
    }

    // EGRESS & REQUEST SAVER:
    // Si el valor a enviar es idéntico al último enviado con éxito a la nube, abortar antes del POST HTTP.
    const hashKey = LAST_PUSH_HASH_PREFIX + key;
    const currentHash = quickHash(payloadToUpload);
    if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) {
        return true;
    }

    try {
        const collectionType = LOCAL_KEYS.includes(key) ? 'local' : 'store';

        // La tabla sync_documents permanece cerrada para anon. El RPC valida
        // pairing, whitelist y tamaño, y el trigger del servidor escribe
        // `updated_at` sin mezclar relojes del cliente y del lector.
        const { error } = await supabaseCloud.rpc('write_paired_sync_document', {
            p_device_id: activeDeviceId,
            p_collection: collectionType,
            p_doc_id: key,
            p_data: { payload: payloadToUpload },
        });

        if (error) {
            if (error.code === '42501' || error.status === 401) {
                // RLS rechazó el upsert porque el dispositivo no está registrado en device_pairings ni autenticado.
                // Pausar sync activo para evitar peticiones fallidas repetitivas.
                isCloudSyncActive = false;
            } else {
                console.warn(`[CloudSync] Error ${error.code || error.status} al subir ${key}:`, error.message);
            }
            return false; // No guardar hash para reintentar cuando Supabase responda
        }

        // D1: `pushCloudSync` es el ÚNICO punto que escribe el hash de egress.
        // Los llamadores NO deben escribirlo: si lo hacen, una subida fallida
        // queda marcada como completada y esa clave no se reintenta nunca más.
        localStorage.setItem(hashKey, currentHash);
        return true;

    } catch (e) {
        // Silencioso en producción
        return false;
    }
};

/**
 * Las publicaciones de una misma clave deben terminar en el mismo orden en
 * que fueron solicitadas. Supabase no conoce la intención temporal del
 * cliente; sin esta cola, una petición vieja en vuelo podía completar después
 * de una nueva y devolver el catálogo anterior al monitor.
 */
export const pushCloudSync = (key, value, forceUnconditional = false) => (
    serializedCloudPush(key, () => pushCloudSyncNow(key, value, forceUnconditional))
);

/**
 * Empuja de forma forzada TODOS los datos del punto de venta a la nube Supabase.
 * Se invoca al iniciar la app o al generar un nuevo código de vinculación.
 */
export const forceSyncAllPOSData = async (overrideDeviceId, forceUnconditional = false) => {
    if (!supabaseCloud) return;
    const isMonitor = localStorage.getItem('dj_pairing_mode') === 'monitor';
    if (isMonitor) return;

    const activeDeviceId = overrideDeviceId || _currentDeviceId || localStorage.getItem('dj_device_id');
    if (!activeDeviceId) return false;

    // El POS puede operar como anon; el RPC aplica la autorización por pairing.
    // Si existe una sesión Auth distinta, se mantiene el bloqueo de identidad.
    const session = await getCloudSession();
    if (session && session.user?.id !== activeDeviceId) {
        isCloudSyncActive = false;
        console.info('[CloudSync] Sincronización pausada: la sesión Auth no coincide con la caja.');
        return false;
    }

    // Habilitar sync activo cuando se fuerza la sincronización explícitamente (ej: al generar código QR de emparejamiento)
    isCloudSyncActive = true;

    try {
        let allSucceeded = true;
        const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
        
        for (const key of IDB_KEYS) {
            if (CLOUD_SYNC_EXCLUDE.includes(key)) continue;
            const val = await lf.getItem(key);
            if (val !== null) {
                const hashKey = LAST_PUSH_HASH_PREFIX + key;
                const currentHash = quickHash(val);
                if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) continue;
                // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                const pushed = await pushCloudSync(key, val, forceUnconditional);
                allSucceeded = pushed && allSucceeded;
            }
        }
        for (const key of LOCAL_KEYS) {
            if (CLOUD_SYNC_EXCLUDE.includes(key)) continue;
            const val = localStorage.getItem(key);
            if (val !== null) {
                const hashKey = LAST_PUSH_HASH_PREFIX + key;
                const currentHash = quickHash(val);
                if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) continue;
                let parsed = val;
                try { parsed = JSON.parse(val); } catch {}
                // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                const pushed = await pushCloudSync(key, parsed, forceUnconditional);
                allSucceeded = pushed && allSucceeded;
            }
        }
        if (allSucceeded) {
            console.log('[CloudSync] Sincronización POS verificada/completada para device_id:', activeDeviceId);
        } else {
            console.warn('[CloudSync] Sincronización POS incompleta; los documentos quedan pendientes hasta reactivar la autorización.');
        }
        return allSucceeded;
    } catch (e) {
        console.warn('[CloudSync] Error en sincronización forzada POS:', e);
        return false;
    }
};

/**
 * EGRESS-FIX (RC2 + RC5): encola un push de una key `store` a la nube a través
 * del debounce por-key (`_debouncePush`), en vez de empujar directo. Esto:
 *   • Agrupa ráfagas de ediciones en las keys pesadas (HEAVY_KEYS → 3000ms).
 *   • Colapsa el antiguo doble-push (storageService.setItem + listener de este
 *     hook) en un solo upsert, ya que ambos caían en la misma key del debounce.
 * `_debouncePush` → `pushCloudSync`, que respeta isSyncingFromCloud /
 * isCloudSyncActive / SYNC_KEYS, así que la seguridad anti-eco se preserva.
 *
 * @param {string} key
 * @param {any} value
 */
export const queueCloudSync = (key, value) => {
    if (!SYNC_KEYS.includes(key)) return;
    if (key === 'abasto-auth-storage') return; // SEC-002
    _debouncePush(key, value);
};

/**
 * SEC-009 / HOOK-011: Reemplazo EXPLÍCITO del antiguo monkeypatch.
 *
 * Los callers que escriban directamente en localStorage con una clave en LOCAL_KEYS
 * deben invocar esta función (o usar `storageService.setItem`) para que el cambio
 * se propague a la nube. Ya NO se intercepta automáticamente `localStorage.setItem`.
 *
 * @param {string} key
 * @param {any} value
 */
export const pushLocalSync = (key, value) => {
    if (!LOCAL_KEYS.includes(key) && !SYNC_KEYS.includes(key)) return;
    if (key === 'abasto-auth-storage') return; // SEC-002
    _debouncePush(key, value);
};

/**
 * Aplica un documento recibido de la nube al almacenamiento local.
 * Garantiza que isSyncingFromCloud esté activo durante toda la operación.
 */
async function _applyFromCloud(docId, collection, payload) {
    isSyncingFromCloud = true;
    try {
        if (collection === 'local') {
            // Ignorar payload nulo/undefined para no escribir "undefined" en localStorage
            if (payload == null) return;
            // SEC-002: nunca aplicar `abasto-auth-storage` desde la nube.
            if (docId === 'abasto-auth-storage') return;
            const stringPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
            originalSetItem(docId, stringPayload);   // Escribe sin pasar por interceptor (no existe ya)
            window.dispatchEvent(new StorageEvent('storage', {
                key: docId,
                newValue: stringPayload,
                storageArea: localStorage
            }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId } }));
        } else {
            // Colección 'store' → IndexedDB directo, sin pasar por storageService.setItem
            const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            let payloadToApply = payload;
            if (docId === 'bodega_products_v1' && Array.isArray(payload)) {
                const localProducts = await lf.getItem(docId);
                payloadToApply = mergeCloudProductImages(payload, localProducts);
            }
            await lf.setItem(docId, payloadToApply);

            // Notificar a los componentes React que lean este store
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId } }));
        }

        // D1: no es un push. Sella el valor recién recibido de la
        // nube para que el ciclo periódico no lo re-suba en eco.
        localStorage.setItem(LAST_PUSH_HASH_PREFIX + docId, quickHash(payload));
    } finally {
        isSyncingFromCloud = false;
    }
}

// ─── Hook de React ─────────────────────────────────────────────────────────
export function useCloudSync(deviceId) {
    const isInitialized = useRef(false);
    
    // Escuchar comandos del supervisor en tiempo real
    useSupervisorCommands(deviceId);

    useEffect(() => {
        if (!supabaseCloud || !deviceId) {
            isCloudSyncActive = false;
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
                isInitialized.current = false;
                _currentDeviceId = '';
            }
            return;
        }

        // Si el deviceId cambió con respecto al inicializado, forzar reinicio y cleanup de suscripción
        if (isInitialized.current && _currentDeviceId !== deviceId) {
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
            }
            localStorage.removeItem('dj_cloud_sync_ts');
            isInitialized.current = false;
        }

        if (isInitialized.current) return;

        _currentDeviceId = deviceId;

        const initSync = async () => {
            try {
                const isMonitor = localStorage.getItem('dj_pairing_mode') === 'monitor';
                if (isMonitor) {
                    isCloudSyncActive = false;
                    return;
                }

                // D1/E1: las versiones anteriores escribían el hash de egress aunque el
                // upsert hubiese fallado, dejando claves marcadas como "ya subidas" que en
                // realidad nunca llegaron. Se purgan una única vez para forzar una
                // reconciliación completa. La marca evita repetirlo en cada arranque.
                const HASH_PURGE_FLAG = 'dj_egress_hash_purge_v2';
                if (!localStorage.getItem(HASH_PURGE_FLAG)) {
                    try {
                        const stale = [];
                        for (let i = 0; i < localStorage.length; i++) {
                            const k = localStorage.key(i);
                            if (k && k.startsWith(LAST_PUSH_HASH_PREFIX)) stale.push(k);
                        }
                        stale.forEach(k => localStorage.removeItem(k));
                        localStorage.setItem(HASH_PURGE_FLAG, '1');
                        console.log(`[CloudSync] Purga única de ${stale.length} hashes de egress envenenados por migración de nube (v2).`);
                    } catch (e) {
                        console.warn('[CloudSync] No se pudo purgar los hashes de egress:', e);
                    }
                }

                // ── Verificar Permisos / Estado de Registro del Dispositivo antes de activar CloudSync ──
                const session = await getCloudSession();
                const sessionMatchesDevice = !session || session.user?.id === deviceId;

                if (!sessionMatchesDevice) {
                    isCloudSyncActive = false;
                    isInitialized.current = true;
                    console.info('[CloudSync] Sincronización pausada: la sesión Auth no coincide con la caja.');
                    return;
                }

                // ── Sincronización activa para el punto de venta (RPC por pairing) ──
                isCloudSyncActive = true;
                isInitialized.current = true;

                // Sincronizar automáticamente todos los datos del POS a la nube en segundo plano (forzado incondicional)
                forceSyncAllPOSData(deviceId, true).catch(() => {});

                // ── Pull Inicial / Sincronización de Importación ──
                const backupImported = localStorage.getItem('dj_backup_imported_flag') === 'true';
                
                if (backupImported) {
                    console.log('[CloudSync] Detectado backup importado localmente. Subiendo datos locales a la nube...');
                    const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    
                    // Subir datos de IndexedDB con empuje incondicional
                    for (const key of IDB_KEYS) {
                        const localValue = await lf.getItem(key);
                        if (localValue !== null) {
                            // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                            await pushCloudSync(key, localValue, true);
                        }
                    }
                    
                    // Subir datos de localStorage con empuje incondicional
                    for (const key of LOCAL_KEYS) {
                        const localVal = localStorage.getItem(key);
                        if (localVal !== null) {
                            let parsed = localVal;
                            try { parsed = JSON.parse(localVal); } catch {}
                            // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                            await pushCloudSync(key, parsed, true);
                        }
                    }

                    localStorage.removeItem('dj_backup_imported_flag');
                    localStorage.setItem('dj_cloud_sync_ts', new Date().toISOString());
                    console.log('[CloudSync] Sincronización de importación completada e incondicional de todas las llaves.');
                } else {
                    const lastSyncIso = localStorage.getItem('dj_cloud_sync_ts');
                    const lastFullPullTs = parseInt(localStorage.getItem('dj_last_full_pull_ts') || '0', 10);
                    const nowTs = Date.now();
                    const FULL_PULL_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

                    let query = supabaseCloud
                        .from('sync_documents')
                        .select('collection, doc_id, data, updated_at')
                        .eq('device_id', deviceId)
                        .in('collection', ['store', 'local']);

                    if (lastSyncIso) {
                        query = query.gt('updated_at', lastSyncIso);
                    } else if (nowTs - lastFullPullTs < FULL_PULL_MIN_INTERVAL_MS) {
                        // Rate limiter: evitar re-descargar los 1.1 MB completos si el cold start ocurrió hace menos de 5 min
                        console.log('[CloudSync] Full-Pull masivo omitido por Rate Limiter (< 5 min). Usando datos locales.');
                        localStorage.setItem('dj_cloud_sync_ts', new Date(lastFullPullTs).toISOString());
                        query = query.gt('updated_at', new Date(lastFullPullTs).toISOString());
                    } else {
                        // D3: `dj_last_full_pull_ts` ya no se marca aquí. Se escribe
                        // después del pull exitoso (ver más abajo), para que un fallo
                        // no bloquee el reintento durante 5 minutos.
                    }

                    // D4: antes se descartaba `error` y el cursor avanzaba igual,
                    // de modo que un pull fallido hacía perder esa ventana de
                    // cambios para siempre.
                    const { data: docs, error: pullError } = await query;

                    if (pullError) {
                        console.warn('[CloudSync] Pull incremental falló; el cursor NO avanza:', pullError.message);
                        throw pullError;
                    }

                    if (docs?.length > 0) {
                        for (const doc of docs) {
                            // SEC-002: nunca aplicar `abasto-auth-storage` desde la nube.
                            if (doc.doc_id === 'abasto-auth-storage') continue;
                            try {
                                await _applyFromCloud(doc.doc_id, doc.collection, doc.data.payload);
                            } catch (e) {
                                // HOOK-023: try/catch por documento para no abortar el pull completo.
                                console.warn(`[CloudSync] Error aplicando doc ${doc.doc_id}:`, e);
                            }
                        }
                        console.log(`[CloudSync] Pull incremental (${lastSyncIso ? 'cambios' : 'inicial'}): ${docs.length} documentos aplicados.`);
                    }
                    // D4/D5: el cursor sale del `updated_at` máximo REALMENTE recibido.
                    // Usar el reloj local hacía que cualquier desfase con el servidor
                    // saltase una ventana de escrituras de forma silenciosa.
                    const maxUpdatedAt = (docs || []).reduce((acc, d) => {
                        const t = d?.updated_at ? new Date(d.updated_at).getTime() : 0;
                        return t > acc ? t : acc;
                    }, 0);
                    if (maxUpdatedAt > 0) {
                        localStorage.setItem('dj_cloud_sync_ts', new Date(maxUpdatedAt).toISOString());
                    } else if (!lastSyncIso) {
                        // Primer pull sin resultados: sellar para no repetir el full pull.
                        localStorage.setItem('dj_cloud_sync_ts', new Date().toISOString());
                    }
                    // D3: el rate limiter del full pull también se marca aquí, ya con éxito.
                    if (!lastSyncIso && nowTs - lastFullPullTs >= FULL_PULL_MIN_INTERVAL_MS) {
                        localStorage.setItem('dj_last_full_pull_ts', String(nowTs));
                    }
                }

                // ── Auto-recuperación: Purgar/subir datos locales que no llegaron a enviarse debido al bug anterior ──
                // Solo si cambiaron desde el último push (mismo hash-guard que forcePushLocalData,
                // para no re-subir todo en cada arranque/reconexión sin necesidad).
                try {
                    const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    
                    // Procesar IndexedDB
                    for (const key of IDB_KEYS) {
                        const localValue = await lf.getItem(key);
                        if (!localValue) continue;

                        const hashKey = LAST_PUSH_HASH_PREFIX + key;
                        const currentHash = quickHash(localValue);
                        if (localStorage.getItem(hashKey) === currentHash) continue;

                        // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                        await pushCloudSync(key, localValue);
                    }

                    // Procesar localStorage
                    for (const key of LOCAL_KEYS) {
                        const localVal = localStorage.getItem(key);
                        if (localVal === null) continue;

                        const hashKey = LAST_PUSH_HASH_PREFIX + key;
                        const currentHash = quickHash(localVal);
                        if (localStorage.getItem(hashKey) === currentHash) continue;

                        let parsed = localVal;
                        try { parsed = JSON.parse(localVal); } catch {}
                        // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                        await pushCloudSync(key, parsed);
                    }
                } catch (e) {
                    // Silencioso
                }

                // ── Suscripción WebSocket Realtime ─────────────────────────
                // EGRESS-FIX (RC3): ELIMINADA la auto-suscripción a `sync:${deviceId}`.
                // El dispositivo principal es el ÚNICO escritor de su propio device_id,
                // así que ese canal solo le devolvía el ECO de sus propias escrituras
                // (egress puro de Realtime, sin valor). El monitor del dueño mantiene su
                // propia suscripción independiente en useMonitorSync (canal
                // `monitor:${pairedDeviceId}`), por lo que sigue recibiendo cambios en
                // vivo. El estado inicial se obtiene con el pull por PostgREST de arriba.

            } catch (err) {
                console.error('[CloudSync] Fallo en inicialización:', err);
                isInitialized.current = false;
            }
        };

        initSync();

        // ── MECANISMOS DE SINCRONIZACIÓN AUTOMÁTICA Y CONTINUA ──
        
        // EGRESS-FIX (RC2): ELIMINADO el listener de `app_storage_update` que
        // re-empujaba a la nube. Era la segunda mitad del doble-push: cada escritura
        // por `storageService.setItem` ya encola el push (ahora vía queueCloudSync),
        // así que este listener solo duplicaba el upsert (y su broadcast de Realtime).
        // Ningún write local dependía SOLO de este listener.

        // Escuchar evento 'online' y temporizador periódico para sincronizar datos locales pendientes
        // HOOK: solo re-sube una key si cambió desde el último push (evita gastar cuota de
        // Supabase/Realtime subiendo el mismo dato sin cambios cada 20s — ver quickHash arriba).
        const forcePushLocalData = async () => {
            if (isSyncingFromCloud || !deviceId) return;
            try {
                const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                
                // Procesar IndexedDB
                for (const key of IDB_KEYS) {
                    const localValue = await lf.getItem(key);
                    if (!localValue) continue;

                    const hashKey = LAST_PUSH_HASH_PREFIX + key;
                    const currentHash = quickHash(localValue);
                    if (localStorage.getItem(hashKey) === currentHash) continue;

                    // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                    await pushCloudSync(key, localValue);
                }

                // Procesar localStorage
                for (const key of LOCAL_KEYS) {
                    const localVal = localStorage.getItem(key);
                    if (localVal === null) continue;

                    const hashKey = LAST_PUSH_HASH_PREFIX + key;
                    const currentHash = quickHash(localVal);
                    if (localStorage.getItem(hashKey) === currentHash) continue;

                    let parsed = localVal;
                    try { parsed = JSON.parse(localVal); } catch {}
                    // D1: el hash lo escribe pushCloudSync solo si el upsert tuvo éxito.
                    await pushCloudSync(key, parsed);
                }
            } catch (e) {
                // Silencioso
            }
        };

        window.addEventListener('online', forcePushLocalData);
        
        // Ejecución periódica cada 60 segundos para asegurar sincronización en tiempo real
        const intervalId = setInterval(forcePushLocalData, 60000);

        // Heartbeat de presencia de la caja principal hacia la nube (cada 60s).
        // La presencia es independiente de la sincronización de datos: si Auth/RLS
        // pausa CloudSync, el Supervisor aún debe poder saber que la caja está abierta.
        // `touch_pos_heartbeat` solo actualiza una autorización existente; no concede
        // acceso por sí mismo.
        const pingPosPresence = async () => {
            if (!navigator.onLine || !deviceId) return;

            try {
                const { data: hb, error: heartbeatError } = await supabaseCloud.rpc('touch_pos_heartbeat', {
                    p_device_id: deviceId,
                });

                if (heartbeatError) {
                    console.warn('[CloudSync] No se pudo actualizar el heartbeat de la caja:', heartbeatError.message);
                    return;
                }

                // El registro inicial sigue siendo deliberado y solo aplica cuando
                // CloudSync ya verificó la identidad de la caja con Auth.
                if (isCloudSyncActive && hb && hb.registered === false) {
                    const { error: registerError } = await supabaseCloud.rpc('register_pos_device', {
                        p_device_id: deviceId,
                    });
                    if (registerError) {
                        console.warn('[CloudSync] No se pudo registrar la caja:', registerError.message);
                    } else {
                        console.log('[CloudSync] Dispositivo POS registrado en la nube:', deviceId);
                    }
                }

                if (hb?.success === false) {
                    console.warn('[CloudSync] La caja no está registrada para presencia:', hb.message || 'registro requerido');
                }
            } catch (error) {
                console.warn('[CloudSync] Error enviando heartbeat de la caja:', error?.message || error);
            }
        };

        const handlePresenceOnline = () => { pingPosPresence(); };
        const handlePresenceVisibility = () => {
            if (document.visibilityState === 'visible') pingPosPresence();
        };

        pingPosPresence();
        const presenceIntervalId = setInterval(pingPosPresence, 60000);
        window.addEventListener('online', handlePresenceOnline);
        document.addEventListener('visibilitychange', handlePresenceVisibility);

        return () => {
            isCloudSyncActive = false;
            if (gateRetryTimer) {
                clearTimeout(gateRetryTimer);
                gateRetryTimer = null;
            }
            window.removeEventListener('online', forcePushLocalData);
            window.removeEventListener('online', handlePresenceOnline);
            document.removeEventListener('visibilitychange', handlePresenceVisibility);
            clearInterval(intervalId);
            clearInterval(presenceIntervalId);

            // HOOK-012: limpiar suscripción en cleanup para evitar leaks.
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
                isInitialized.current = false;
                _currentDeviceId = '';
            }
        };
    }, [deviceId]);
}
