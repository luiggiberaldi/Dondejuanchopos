// src/utils/salesDeltaSync.js
// Cálculo puro y determinista del lote delta de `bodega_sales_v1` para
// `upsert_paired_sales_delta`. Nunca muta registros ni elimina historial.

export const SALES_SYNC_FINGERPRINTS_KEY = 'bodega_sales_sync_fingerprints_v1';
export const SALES_DELTA_MAX_BATCH = 250;
// Margen seguro por debajo del tope SQL de 2 MB (2_097_152 bytes) para delta RPC.
export const SALES_DELTA_MAX_BYTES = 1536 * 1024;
const COLD_CLOSE_LOOKBACK_MS = 72 * 60 * 60 * 1000;

function approxJsonBytes(value) {
    try {
        const serialized = JSON.stringify(value) ?? '';
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(serialized).length;
        }
        return serialized.length * 2;
    } catch {
        return Infinity;
    }
}

function summarizePaymentsForFingerprint(payments) {
    if (!Array.isArray(payments) || payments.length === 0) return '';
    return payments
        .map((p) => (p && typeof p === 'object'
            ? `${p.methodId || p.id || ''}:${p.currency || ''}:${p.amountBs ?? ''}:${p.amountUsd ?? ''}:${p.amountCop ?? ''}`
            : ''))
        .join(',');
}

/** Hash FNV-1a (32 bits) sobre el JSON completo del registro. */
function hashRecordJson(sale) {
    let str;
    try {
        str = JSON.stringify(sale) ?? '';
    } catch {
        return 'x';
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return `${str.length}.${(h >>> 0).toString(36)}`;
}

/**
 * Huella determinista por registro de `bodega_sales_v1`.
 * Cubre todos los campos mutables (sellado, anulación, reclasificación de pago,
 * montos, apertura, summary de cierre, numeración y archivado) y, además, un
 * hash del registro COMPLETO: cualquier otro cambio (cliente asignado tras la
 * venta, contenido de ítems con la misma longitud, notas) también marca el
 * registro como pendiente. Sin este hash esas ediciones nunca viajaban en el
 * delta mientras hubiera otra venta nueva en el mismo ciclo.
 */
export function computeSaleSyncFingerprint(sale) {
    if (!sale || typeof sale !== 'object' || !sale.id) return '';
    const itemLen = Array.isArray(sale.items)
        ? sale.items.length
        : (Number(sale.itemCount) || 0);
    const summarySig = sale.tipo === 'REGISTRO_CIERRE' && sale.summary
        ? `${sale.summary.todayTotalUsd ?? ''}:${sale.summary.todayTotalBs ?? ''}:${sale.summary.todayItemsSold ?? ''}`
        : '';

    return [
        sale.tipo || '',
        sale.updatedAt || sale.timestamp || sale.createdAt || '',
        sale.cajaCerrada === true ? '1' : '0',
        sale.cierreId != null ? String(sale.cierreId) : '',
        sale.cierreNumber != null ? String(sale.cierreNumber) : '',
        sale.status || '',
        sale.anuladaAt || '',
        sale.totalUsd ?? '',
        sale.totalBs ?? '',
        sale.openingBs ?? '',
        sale.openingUsd ?? '',
        summarizePaymentsForFingerprint(sale.payments),
        itemLen,
        sale.saleNumber ?? '',
        sale.isArchived === true ? 'A' : '',
        summarySig,
        hashRecordJson(sale),
    ].join('|');
}

export function buildSyncedFingerprintsMap(salesList) {
    const map = {};
    if (!Array.isArray(salesList)) return map;
    for (let i = 0; i < salesList.length; i++) {
        const s = salesList[i];
        if (s && typeof s === 'object' && s.id) {
            map[s.id] = computeSaleSyncFingerprint(s);
        }
    }
    return map;
}

export function mergeSyncedFingerprints(existingMap, uploadedRecords) {
    const next = existingMap && typeof existingMap === 'object' && !Array.isArray(existingMap)
        ? { ...existingMap }
        : {};
    if (!Array.isArray(uploadedRecords)) return next;
    for (let i = 0; i < uploadedRecords.length; i++) {
        const s = uploadedRecords[i];
        if (s && typeof s === 'object' && s.id) {
            next[s.id] = computeSaleSyncFingerprint(s);
        }
    }
    return next;
}

/**
 * Determina si `bodega_sales_v1` puede enviarse como delta liviano o requiere
 * subida completa (`write_paired_sync_document`).
 *
 * Guardrails:
 *  - Si excede `maxBatch` (250) o `maxBytes` (1.5 MB) cae a `'full'`.
 *  - Si `expectedCierreId` está presente, garantiza inclusión del REGISTRO_CIERRE
 *    y de todos los movimientos sellados bajo ese `cierreId` incluso en arranque
 *    en frío o si el mapa de huellas estuviera desfasado.
 *
 * @returns {{ mode: 'unchanged'|'delta'|'full', records: Array|null }}
 */
export function extractSalesDelta(
    localSales,
    syncedFingerprints,
    {
        expectedCierreId = null,
        maxBatch = SALES_DELTA_MAX_BATCH,
        maxBytes = SALES_DELTA_MAX_BYTES,
        nowMs = Date.now(),
    } = {},
) {
    if (!Array.isArray(localSales) || localSales.length === 0) {
        return { mode: 'full', records: null };
    }

    const hasWarmMap = syncedFingerprints
        && typeof syncedFingerprints === 'object'
        && !Array.isArray(syncedFingerprints)
        && Object.keys(syncedFingerprints).length > 0;

    if (!hasWarmMap) {
        if (expectedCierreId != null) {
            const targetId = String(expectedCierreId);
            const cierreRecordId = `cierre_${targetId}`;
            const cutoff = nowMs - COLD_CLOSE_LOOKBACK_MS;
            const coldBatch = localSales.filter((s) => {
                if (!s || typeof s !== 'object' || !s.id) return false;
                if (String(s.cierreId ?? '') === targetId) return true;
                if (s.id === cierreRecordId) return true;
                if (s.cajaCerrada !== true) return true;
                const ts = Date.parse(s.updatedAt || s.timestamp || s.createdAt || '');
                return Number.isFinite(ts) && ts >= cutoff;
            });
            if (coldBatch.length > 0 && coldBatch.length <= maxBatch && approxJsonBytes(coldBatch) <= maxBytes) {
                return { mode: 'delta', records: coldBatch };
            }
        }
        return { mode: 'full', records: null };
    }

    const dirty = [];
    const dirtyIds = new Set();
    for (let i = 0; i < localSales.length; i++) {
        const s = localSales[i];
        if (!s || typeof s !== 'object' || !s.id) continue;
        const fp = computeSaleSyncFingerprint(s);
        if (syncedFingerprints[s.id] !== fp) {
            dirty.push(s);
            dirtyIds.add(s.id);
            if (dirty.length > maxBatch) {
                return { mode: 'full', records: null };
            }
        }
    }

    // Guardrail cierre crítico: garantizar siempre que el REGISTRO_CIERRE y los
    // movimientos sellados de `expectedCierreId` viajen para confirmación real del servidor.
    if (expectedCierreId != null) {
        const targetId = String(expectedCierreId);
        const cierreRecordId = `cierre_${targetId}`;
        for (let i = 0; i < localSales.length; i++) {
            const s = localSales[i];
            if (!s || typeof s !== 'object' || !s.id || dirtyIds.has(s.id)) continue;
            if (String(s.cierreId ?? '') === targetId || s.id === cierreRecordId) {
                dirty.push(s);
                dirtyIds.add(s.id);
                if (dirty.length > maxBatch) {
                    return { mode: 'full', records: null };
                }
            }
        }
    }

    if (dirty.length === 0) {
        return { mode: 'unchanged', records: [] };
    }
    if (approxJsonBytes(dirty) > maxBytes) {
        return { mode: 'full', records: null };
    }
    return { mode: 'delta', records: dirty };
}
