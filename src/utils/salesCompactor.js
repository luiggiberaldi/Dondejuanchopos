/**
 * Compactación determinista del payload de ventas publicado en la nube.
 * Nunca muta la copia local ni elimina registros de venta.
 */

export const SALES_COMPACTION_ENABLED = true;
export const SALES_COMPACTION_THRESHOLD_BYTES = 400 * 1024;
export const SALES_RECENT_DAYS_RETENTION = 15;
export const SALES_ARCHIVE_VERSION = 1;

const ARCHIVABLE_SALE_TYPES = new Set(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);
const INTERNAL_SALE_FIELDS = [
    'inventoryDeductionsApplied',
    'changeLedger',
    'inventoryDeductions',
    'inventoryAnomalies',
];

export function salesPayloadByteLength(value) {
    const serialized = JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(serialized).length;
    return serialized.length * 2;
}

function getItemQuantity(items) {
    if (!Array.isArray(items)) return 0;
    return items.reduce((total, item) => {
        if (!item || typeof item !== 'object') return total + 1;
        const quantity = Number(item.qty);
        return total + (Number.isFinite(quantity) ? quantity : 1);
    }, 0);
}

export function isArchivedSalesPayload(sale) {
    return Boolean(sale && typeof sale === 'object'
        && sale.isArchived === true
        && sale.archiveVersion === SALES_ARCHIVE_VERSION
        && !Array.isArray(sale.items));
}

export function isArchivableSaleType(type) {
    return ARCHIVABLE_SALE_TYPES.has(type);
}

export function getSalesArchiveItemCount(sale) {
    if (Array.isArray(sale?.items)) return getItemQuantity(sale.items);
    const storedCount = Number(sale?.itemCount);
    return Number.isFinite(storedCount) ? storedCount : 0;
}

export function applySalesArchiveMarker(sale, itemCount = getSalesArchiveItemCount(sale)) {
    const archivedSale = { ...sale };
    for (const field of INTERNAL_SALE_FIELDS) delete archivedSale[field];
    delete archivedSale.items;
    return {
        ...archivedSale,
        itemCount,
        isArchived: true,
        archiveVersion: SALES_ARCHIVE_VERSION,
    };
}

function isEligibleForArchive(sale, cutoffTimestamp) {
    if (!sale || typeof sale !== 'object'
        || sale.tipo === 'REGISTRO_CIERRE'
        || !ARCHIVABLE_SALE_TYPES.has(sale.tipo)
        || sale.cajaCerrada !== true
        || (!sale.cierreId && sale.cierreId !== 0)) return false;
    const saleTimestamp = Date.parse(sale.timestamp || sale.createdAt || '');
    return Number.isFinite(saleTimestamp) && saleTimestamp < cutoffTimestamp;
}

/** Fuerza un marcador de archivo en registros antiguos cerrados elegibles. */
export function archiveSalesPayload(salesList, cutoffTimestamp) {
    if (!Array.isArray(salesList)) return salesList;
    return salesList.map(sale => {
        if (!isEligibleForArchive(sale, cutoffTimestamp)) return sale;
        if (isArchivedSalesPayload(sale)) return sale;
        return applySalesArchiveMarker(sale, getSalesArchiveItemCount(sale));
    });
}

/**
 * Conserva el payload de ventas por defecto. Solo archiva detalle histórico si
 * el caller lo habilita explícitamente tras verificar una referencia cloud.
 * Nunca muta la lista local ni se usa para compactar datos persistidos.
 */
export function compactSalesPayload(
    salesList,
    thresholdBytes = SALES_COMPACTION_THRESHOLD_BYTES,
    { allowArchiving = false } = {},
) {
    if (!Array.isArray(salesList) || salesList.length === 0) return salesList;
    if (!SALES_COMPACTION_ENABLED || !allowArchiving) return salesList;

    let payloadBytes;
    try {
        payloadBytes = salesPayloadByteLength(salesList);
    } catch {
        return salesList;
    }
    if (payloadBytes <= thresholdBytes) return salesList;

    const cutoffTimestamp = Date.now() - SALES_RECENT_DAYS_RETENTION * 24 * 60 * 60 * 1000;
    return archiveSalesPayload(salesList, cutoffTimestamp);
}
