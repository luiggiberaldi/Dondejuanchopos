/**
 * Motor de Fusión Determinista y No Destructivo para Ventas (salesMerge.js)
 *
 * Blindaje contra pérdidas de ventas:
 * 1. NUNCA elimina una venta que exista localmente aunque un snapshot remoto no la contenga.
 * 2. Si una venta existe en ambos lados, preserva el estado más avanzado (cajaCerrada, anulaciones, deducciones aplicadas).
 * 3. Mantiene el orden cronológico descendente canónico.
 */

/**
 * Fusiona un array entrante de ventas (ej. pull de nube) con el array local existente.
 *
 * @param {Array} incomingSales - Ventas recibidas del servidor o pull remoto.
 * @param {Array} localSales - Ventas almacenadas actualmente en el dispositivo local.
 * @returns {Array} Array consolidado y ordenado sin pérdida de registros.
 */
export function mergeSalesArrays(incomingSales, localSales) {
    const isIncomingArray = Array.isArray(incomingSales);
    const isLocalArray = Array.isArray(localSales);

    if (!isIncomingArray && !isLocalArray) return [];
    if (!isIncomingArray) return [...localSales];
    if (!isLocalArray || localSales.length === 0) return [...incomingSales];

    // Mapa base con todas las ventas locales indexadas por ID
    const salesById = new Map();
    for (const localSale of localSales) {
        if (localSale && typeof localSale === 'object' && localSale.id) {
            salesById.set(localSale.id, localSale);
        }
    }

    // Procesar ventas entrantes
    for (const incomingSale of incomingSales) {
        if (!incomingSale || typeof incomingSale !== 'object' || !incomingSale.id) {
            continue;
        }

        const existingLocal = salesById.get(incomingSale.id);
        if (!existingLocal) {
            // Venta nueva proveniente del pull remoto
            salesById.set(incomingSale.id, incomingSale);
        } else {
            // Venta existente en ambos: fusionar preservando el estado más completo y avanzado
            const merged = mergeSingleSale(existingLocal, incomingSale);
            salesById.set(incomingSale.id, merged);
        }
    }

    // Convertir a array y ordenar cronológicamente descendente (más recientes primero)
    const result = Array.from(salesById.values());
    result.sort((a, b) => {
        const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
        const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
        return timeB - timeA;
    });

    return result;
}

/**
 * Fusiona dos versiones de un mismo registro de venta.
 * Prioriza integridad contable y estados sellados.
 */
function mergeSingleSale(local, incoming) {
    const localTs = new Date(local.updatedAt || local.timestamp || 0).getTime();
    const incomingTs = new Date(incoming.updatedAt || incoming.timestamp || 0).getTime();

    // Base: usar la versión con timestamp de actualización más reciente
    const base = incomingTs > localTs ? { ...local, ...incoming } : { ...incoming, ...local };

    // Regla de Oro 1: Si la venta fue cerrada en caja localmente, se preserva cerrada
    if (local.cajaCerrada === true || incoming.cajaCerrada === true) {
        base.cajaCerrada = true;
        base.cierreId = local.cierreId ?? incoming.cierreId;
        base.cierreNumber = local.cierreNumber ?? incoming.cierreNumber;
    }

    // Regla de Oro 2: Si la venta fue anulada en cualquiera de los lados, se preserva como ANULADA
    if (local.status === 'ANULADA' || incoming.status === 'ANULADA') {
        base.status = 'ANULADA';
        base.anuladaAt = local.anuladaAt || incoming.anuladaAt;
        base.anuladaPor = local.anuladaPor || incoming.anuladaPor;
        base.motivoAnulacion = local.motivoAnulacion || incoming.motivoAnulacion;
    }

    // Regla de Oro 3: Preservar deducciones de inventario aplicadas si una de las dos las tiene
    if (Array.isArray(local.inventoryDeductionsApplied) && local.inventoryDeductionsApplied.length > 0) {
        base.inventoryDeductionsApplied = local.inventoryDeductionsApplied;
    } else if (Array.isArray(incoming.inventoryDeductionsApplied) && incoming.inventoryDeductionsApplied.length > 0) {
        base.inventoryDeductionsApplied = incoming.inventoryDeductionsApplied;
    }

    // Regla de Oro 4: Preservar identificador de operación de checkout e inventario
    base.checkoutOperationId = local.checkoutOperationId || incoming.checkoutOperationId || base.checkoutOperationId;
    base.inventoryOperationId = local.inventoryOperationId || incoming.inventoryOperationId || base.inventoryOperationId;

    return base;
}

/**
 * Detecta si una escritura causaría una reducción anómala en la cantidad de ventas.
 */
export function isSalesArrayShrinking(newSales, existingSales) {
    if (!Array.isArray(existingSales) || !Array.isArray(newSales)) return false;
    return existingSales.length > 0 && newSales.length < existingSales.length;
}
