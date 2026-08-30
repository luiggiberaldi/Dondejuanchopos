/**
 * salesCompactor.js — Compactador y optimizador inteligente de ventas para sincronización en la nube.
 *
 * Objetivo:
 *   - Evitar que el documento bodega_sales_v1 supere el tope de seguridad de 8 MB.
 *   - Si el payload supera los 4 MB (COMPACTION_THRESHOLD_BYTES), compacta metadatos
 *     de cálculo interno en transacciones antiguas (> 60 días ya cerradas en arqueos).
 *
 * Blindajes de Integridad:
 *   1. El turno activo (ventas sin cerrar y apertura) NUNCA se modifica.
 *   2. Todos los registros `REGISTRO_CIERRE` conservan su `summary` íntegro con totales USD, Bs, ganancias y formas de pago.
 *   3. Todas las ventas de los últimos 60 días conservan sus productos y recibos completos.
 *   4. Kardex, inventario y respaldos locales en IndexedDB (bodega_sales_mirror_v1) no se alteran.
 */

export const SALES_COMPACTION_THRESHOLD_BYTES = 4 * 1024 * 1024; // 4 MB
export const SALES_RECENT_DAYS_RETENTION = 60; // 60 días completos con detalle total

/**
 * Sanitiza y compacta el listado de ventas para sincronización con la nube.
 *
 * @param {Array} salesList Lista de ventas y registros de cierre
 * @param {number} thresholdBytes Umbral en bytes para activar compactación profunda (def: 4MB)
 * @returns {Array} Lista optimizada y lista para subir a la nube
 */
export function compactSalesPayload(salesList, thresholdBytes = SALES_COMPACTION_THRESHOLD_BYTES) {
    if (!Array.isArray(salesList) || salesList.length === 0) {
        return salesList;
    }

    const now = Date.now();
    const cutoffTimestamp = now - (SALES_RECENT_DAYS_RETENTION * 24 * 60 * 60 * 1000);

    // 1. Sanitización estándar (limpia arrays de cálculo interno efímero en ventas cerradas)
    const sanitized = salesList.map(s => {
        if (!s || typeof s !== 'object') return s;

        // Cierres de caja se preservan 100% íntegros
        if (s.tipo === 'REGISTRO_CIERRE') {
            return s;
        }

        // Aperturas activas y ventas del turno en curso se preservan 100% íntegras
        if (!s.cajaCerrada) {
            return s;
        }

        // Para ventas cerradas, remover metadatos pesados de cálculo interno
        const {
            inventoryDeductionsApplied,
            changeLedger,
            inventoryDeductions,
            inventoryAnomalies,
            ...cleanSale
        } = s;

        // Mantener items limpios y concisos
        if (Array.isArray(cleanSale.items)) {
            cleanSale.items = cleanSale.items.map(item => {
                if (!item || typeof item !== 'object') return item;
                return {
                    id: item.id,
                    name: item.name,
                    qty: item.qty,
                    priceUsd: item.priceUsd,
                    costUsd: item.costUsd,
                    costBs: item.costBs,
                    subtotalBs: item.subtotalBs
                };
            });
        }

        return cleanSale;
    });

    // 2. Si el tamaño estimado sigue por encima del umbral de 4 MB, compactar transacciones de más de 60 días
    let approxSize = 0;
    try {
        approxSize = JSON.stringify(sanitized).length;
    } catch {
        return sanitized;
    }

    if (approxSize <= thresholdBytes) {
        return sanitized;
    }

    // 3. Compactación profunda para ventas antiguas cerradas (> 60 días)
    return sanitized.map(s => {
        if (!s || typeof s !== 'object') return s;
        if (s.tipo === 'REGISTRO_CIERRE' || !s.cajaCerrada) return s;

        const saleTime = s.timestamp ? new Date(s.timestamp).getTime() : 0;
        const isOlderThanRetention = saleTime > 0 && saleTime < cutoffTimestamp;

        if (isOlderThanRetention) {
            // Conservar cabecera contable y comercial, podar listas masivas de items
            const {
                items,
                ...archivedHeader
            } = s;

            return {
                ...archivedHeader,
                itemCount: Array.isArray(items) ? items.reduce((acc, i) => acc + (Number(i.qty) || 1), 0) : 0,
                isArchived: true
            };
        }

        return s;
    });
}
