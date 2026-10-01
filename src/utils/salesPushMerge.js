/**
 * prepareSalesPushPayload (salesPushMerge.js) — FASE 1 del plan maestro.
 *
 * Convierte un push de ventas "todo o nada" en una UNIÓN segura por id,
 * con veto duro de no-encogimiento y referencia cloud real (leída por RPC).
 *
 * Invariantes (todas testeadas en tests/salesPushMerge.test.js):
 *  I1. NUNCA devuelve un array con menos registros que la base cloud de referencia.
 *  I2. Los registros sellados (cierreId/cajaCerrada) se preservan en su versión más
 *      avanzada (la lógica vive en mergeSalesArrays, aquí solo se delega).
 *  I3. Idempotente: fusionar dos veces el mismo contenido no duplica nada.
 *  I4. Si no hay base cloud de referencia, el resultado es exactamente el array local
 *      (comportamiento idéntico al push actual — no introduce cambios).
 *  I5. En empate de `updatedAt` entre local y cloud, GANA LA NUBE: el dispositivo
 *      con historial truncado no puede resucitar versiones viejas que ya fueron
 *      corregidas/canonizadas en la nube (incidente 11-09/12-09).
 */

import { mergeSalesArrays } from './salesMerge';
import { supabaseCloud } from '../config/supabaseCloud';
import { applySalesArchiveMarker, getSalesArchiveItemCount, isArchivedSalesPayload } from './salesCompactor';

const SALES_DETAIL_FIELDS = new Set([
    'items', 'inventoryDeductionsApplied', 'changeLedger', 'inventoryDeductions', 'inventoryAnomalies',
    'itemCount', 'isArchived', 'archiveVersion',
]);

function stableArchiveHeader(value) {
    if (Array.isArray(value)) return value.map(stableArchiveHeader);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value)
        .filter(key => !SALES_DETAIL_FIELDS.has(key) && value[key] !== undefined)
        .sort()
        .map(key => [key, stableArchiveHeader(value[key])]));
}

function isCloudDetailSubsetOfSource(cloudDetail, sourceDetail) {
    if (Array.isArray(cloudDetail)) {
        return Array.isArray(sourceDetail)
            && cloudDetail.length === sourceDetail.length
            && cloudDetail.every((entry, index) => isCloudDetailSubsetOfSource(entry, sourceDetail[index]));
    }
    if (cloudDetail && typeof cloudDetail === 'object') {
        if (!sourceDetail || typeof sourceDetail !== 'object' || Array.isArray(sourceDetail)) return false;
        return Object.keys(cloudDetail).every(key => Object.prototype.hasOwnProperty.call(sourceDetail, key)
            && isCloudDetailSubsetOfSource(cloudDetail[key], sourceDetail[key]));
    }
    return cloudDetail === sourceDetail;
}

function hasSameArchiveHeader(localSale, cloudSale) {
    if (!localSale || !cloudSale || localSale.id !== cloudSale.id) return false;
    const sameHeader = JSON.stringify(stableArchiveHeader(localSale)) === JSON.stringify(stableArchiveHeader(cloudSale));
    if (!sameHeader) return false;
    if (isArchivedSalesPayload(cloudSale)) return true;
    return Array.isArray(localSale.items)
        && Array.isArray(cloudSale.items)
        && isCloudDetailSubsetOfSource(cloudSale.items, localSale.items);
}

function applyVerifiedArchiveMarkers(mergedSales, compactedLocal, archiveBaselineSales, cloudReference) {
    const compactedById = new Map(compactedLocal
        .filter(sale => sale && sale.id && isArchivedSalesPayload(sale))
        .map(sale => [sale.id, sale]));
    const baselineById = new Map(archiveBaselineSales.filter(sale => sale && sale.id).map(sale => [sale.id, sale]));
    const cloudById = new Map(cloudReference.filter(sale => sale && sale.id).map(sale => [sale.id, sale]));
    return mergedSales.map(sale => {
        const marker = compactedById.get(sale?.id);
        const baseline = baselineById.get(sale?.id);
        const cloudSale = cloudById.get(sale?.id);
        if (marker && baseline && cloudSale && hasSameArchiveHeader(baseline, cloudSale)) {
            const baselineCount = getSalesArchiveItemCount(baseline);
            const markerCount = getSalesArchiveItemCount(marker);
            if (baselineCount === markerCount) {
                return applySalesArchiveMarker(sale, markerCount);
            }
            if (!isArchivedSalesPayload(sale) && Array.isArray(cloudSale.items)) {
                return { ...sale, items: cloudSale.items };
            }
        }

        // Nunca aceptar un marcador local no verificado si la nube todavía tiene
        // el detalle. Reponerlo en el payload combinado en lugar de perder datos.
        if (isArchivedSalesPayload(sale) && Array.isArray(cloudSale?.items)) {
            const { isArchived, archiveVersion, itemCount, items, ...unarchived } = sale;
            return { ...unarchived, items: cloudSale.items };
        }
        return sale;
    });
}

/** Doc canónico de ventas en la nube. */
export const SALES_CLOUD_CACHE_KEY = 'bodega_sales_v1';

/**
 * RPC SECURITY DEFINER existente: valida que (primary, monitor) estén emparejados
 * y devuelve el documento solicitado. No se concede SELECT sobre sync_documents.
 * NOTA: la autorización recae en el vínculo device_pairings — una identidad
 * suplantada que conozca ambos device_ids podría leer el Doc 60. Es la misma
 * superficie que ya usa el Supervisor hoy (FASE 3A cierra esto con fingerprints).
 */
const READ_RPC = 'read_paired_audit_documents';
const MONITOR_ID_CACHE_KEY = 'dj_cloud_merge_monitor_id';
/** TTL de la referencia cloud: coalesce ráfagas sin permitir divergencia larga. */
const SALES_REF_TTL_MS = 15000;

const _inFlightRefs = new Map();
const _latestRefRequestTokens = new Map();
let _refCache = { payload: null, ts: 0, deviceId: null };

/**
 * Resuelve el monitor vinculado a este POS. La tabla device_pairings es legible
 * por anon (solo expone ids de dispositivo, no datos de negocio). Se cachea en
 * localStorage porque el vínculo no cambia en caliente.
 */
async function resolveMonitorDeviceId(deviceId, client) {
    try {
        const cacheKey = `${MONITOR_ID_CACHE_KEY}_${deviceId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) return cached;
        const { data, error } = await client
            .from('device_pairings')
            .select('monitor_device_id')
            .eq('primary_device_id', deviceId)
            .maybeSingle();
        if (error || !data?.monitor_device_id) return null;
        localStorage.setItem(cacheKey, data.monitor_device_id);
        return data.monitor_device_id;
    } catch {
        return null;
    }
}

/**
 * Lee la copia canónica del Doc 60 para usarla como base del merge-on-push.
 * Devuelve un Array no vacío o null. El caller trata null como error seguro y
 * pospone el push; el circuit breaker clásico sigue protegiendo además por conteo.
 *
 * Con TTL de 15s + single-flight por dispositivo: ráfagas de ventas del mismo POS
 * comparten una sola lectura sin cruzar referencias entre identidades.
 * Compromiso conocido: si otro escritor legítimo actualizara el Doc 60 dentro de
 * esa ventana, el push fusionado podría no incluir ese cambio en el documento
 * resultante. Actualmente se asume un solo escritor POS; validar el modelo de
 * propiedad y la consistencia antes de habilitar el opt-in en producción.
 *
 * @param {string} deviceId - device_id de ESTE dispositivo (el dueño del doc).
 * @param {object} [client] - cliente Supabase inyectable para tests.
 * @param {object} [opts] - { fresh: true } fuerza re-lectura ignorando la caché
 *   TTL (decisiones críticas como replace_sales_history la exigen).
 * @returns {Promise<Array|null>}
 */
export async function fetchCloudSalesReference(deviceId, client = supabaseCloud, { fresh = false } = {}) {
    if (!client || !deviceId) return null;
    try {
        const now = Date.now();
        if (!fresh && _refCache.deviceId === deviceId && _refCache.payload && now - _refCache.ts < SALES_REF_TTL_MS) {
            return _refCache.payload;
        }
        const inFlightRef = fresh ? null : _inFlightRefs.get(deviceId);
        if (inFlightRef) return await inFlightRef;

        const requestToken = Symbol(deviceId);
        _latestRefRequestTokens.set(deviceId, requestToken);
        const refPromise = (async () => {
            const monitorDeviceId = await resolveMonitorDeviceId(deviceId, client);
            if (!monitorDeviceId) return null;

            const { data, error } = await client.rpc(READ_RPC, {
                p_primary_device_id: deviceId,
                p_monitor_device_id: monitorDeviceId,
                p_doc_ids: [SALES_CLOUD_CACHE_KEY],
            });
            if (error || !Array.isArray(data) || data.length === 0) return null;

            const payload = data[0]?.data?.payload;
            if (!Array.isArray(payload) || payload.length === 0) return null;

            if (_latestRefRequestTokens.get(deviceId) === requestToken) {
                _refCache = { payload, ts: Date.now(), deviceId };
            }
            return payload;
        })();
        _inFlightRefs.set(deviceId, refPromise);
        try {
            return await refPromise;
        } finally {
            if (_inFlightRefs.get(deviceId) === refPromise) _inFlightRefs.delete(deviceId);
        }
    } catch {
        return null;
    }
}

/** Reservado para tests: invalida la caché de referencia cloud. */
export function resetCloudSalesReferenceCacheForTests() {
    _refCache = { payload: null, ts: 0, deviceId: null };
    _inFlightRefs.clear();
    _latestRefRequestTokens.clear();
}

/**
 * Prepara el payload a subir para bodega_sales_v1.
 *
 * @param {Array} localSales - Ventas locales del dispositivo (lo que se quería subir).
 * @param {Array|null} cloudReference - Copia canónica del Doc 60 (o null).
 * @returns {{ payload: Array, strategy: 'union-merge'|'passthrough', vetoed: boolean, reason?: string }}
 */
export function prepareSalesPushPayload(localSales, cloudReference, { sourceSales = localSales, archiveBaselineSales = sourceSales } = {}) {
    const isLocalArray = Array.isArray(localSales);
    const fullSourceSales = Array.isArray(sourceSales) ? sourceSales : localSales;
    const sourceBaseline = Array.isArray(archiveBaselineSales) ? archiveBaselineSales : fullSourceSales;

    // `null`/fallo queda fuera de esta función: el caller conserva el historial
    // en cola. La referencia vacía es ambigua y no debe autorizar un reemplazo.
    if (!Array.isArray(cloudReference)) {
        return { payload: isLocalArray ? localSales : [], strategy: 'passthrough', vetoed: false };
    }
    if (!isLocalArray) {
        // Payload local corrupto: jamás sustituir la nube por basura.
        return { payload: cloudReference, strategy: 'union-merge', vetoed: false, reason: 'local-no-array' };
    }
    if (cloudReference.length === 0) {
        // Una referencia vacía no permite asegurar que la nube no contenga
        // historial fuera del alcance del RPC; el caller debe detener el push.
        return { payload: localSales, strategy: 'passthrough', vetoed: true, reason: 'empty-cloud-reference' };
    }

    // ── UNIÓN POR ID, CON LA NUBE COMO LADO QUE GANA EMPATES ──
    // Se fusiona siempre el historial local completo. El payload compactado solo
    // autoriza quitar el detalle tras comparar la cabecera con la nube.
    const mergedFull = mergeSalesArrays(cloudReference, fullSourceSales);
    const merged = applyVerifiedArchiveMarkers(mergedFull, localSales, sourceBaseline, cloudReference);

    // ── CANONIZACIÓN DE SELLADOS (I5 estricta) ──
    // "Regla de Oro 5" de salesMerge.js deja ganar el segundo lado para summaries de
    // REGISTRO_CIERRE; en el push eso permitiría a un local truncado pisar un cierre
    // ya corregido en la nube (incidente 11-09). Aquí mandamos la nube para cualquier
    // registro sellado que exista en la referencia, SALVO que la copia local sea
    // ESTRICTAMENTE más nueva (correcciones legítimas aplicadas por comando).
    const cloudById = new Map(
        cloudReference.filter(s => s && typeof s === 'object' && s.id).map(s => [s.id, s]),
    );
    const canonizado = merged.map((rec) => {
        if (!rec || typeof rec !== 'object' || !rec.id || rec.tipo !== 'REGISTRO_CIERRE') return rec;
        const cloudCopy = cloudById.get(rec.id);
        if (!cloudCopy || cloudCopy.tipo !== 'REGISTRO_CIERRE') return rec;
        const localTs = new Date(rec.updatedAt || rec.timestamp || 0).getTime();
        const cloudTs = new Date(cloudCopy.updatedAt || cloudCopy.timestamp || 0).getTime();
        // El sello y el summary son inmutables por diseño: la nube gana salvo
        // que el local sea estrictamente posterior.
        return localTs > cloudTs ? rec : cloudCopy;
    });

    if (canonizado.length < cloudReference.length) {
        // Defensa en profundidad (mergeSalesArrays es union, no debería ocurrir).
        return {
            payload: cloudReference,
            strategy: 'union-merge',
            vetoed: true,
            reason: `merge encogió el array (${canonizado.length} < ${cloudReference.length}); se usa la referencia cloud intacta`,
        };
    }

    return { payload: canonizado, strategy: 'union-merge', vetoed: false };
}
