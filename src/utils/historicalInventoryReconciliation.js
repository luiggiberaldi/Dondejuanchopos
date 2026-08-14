// src/utils/historicalInventoryReconciliation.js
// Auditoría histórica y plan de reparación en modo dry-run.
// Este módulo es puro: no lee storage, no escribe datos y no aplica ajustes.

import { round2 } from './dinero';
import { expandCartToPhysicalDeductions } from './inventoryMovementModel';

const EPSILON = 0.000001;
const SALE_TYPES = new Set(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);
const MOVEMENT_SALE_TYPE = 'VENTA';
const MOVEMENT_RETURN_TYPE = 'DEVOLUCION';
const PRODUCT_ALERT_CODES = Object.freeze({
    NEGATIVE_STOCK: 'STOCK_NEGATIVO',
    NO_KARDEX: 'SIN_KARDEX_BASE',
    STOCK_MISMATCH: 'STOCK_ACTUAL_DISTINTO_ULTIMO_KARDEX',
    BROKEN_CONTINUITY: 'KARDEX_NO_CONTINUO',
    SALE_NOT_REFLECTED: 'VENTAS_NO_REFLEJADAS',
    MODULAR_NOT_REFLECTED: 'COMPONENTES_MODULARES_NO_REGISTRADOS',
    PARENT_IN_KARDEX: 'SKU_COMBO_PADRE_EN_KARDEX',
});

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function movementTime(movement) {
    const parsed = new Date(movement?.created_at || movement?.timestamp || 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

function isVirtualAmountItem(item) {
    const name = String(item?.name || '').trim().toLowerCase();
    return item?.isCustomAmount === true
        || String(item?.id || '').startsWith('custom_')
        || name === 'venta libre';
}

function hasPhysicalItems(sale) {
    return Array.isArray(sale?.items) && sale.items.some(item => !isVirtualAmountItem(item));
}

function addToMap(map, productId, quantity) {
    if (!productId) return;
    map.set(productId, round2((map.get(productId) || 0) + finiteNumber(quantity)));
}

function mapPositiveDeductions(deductions = []) {
    const quantities = new Map();
    const origins = new Map();
    if (!Array.isArray(deductions)) return { quantities, origins };

    for (const deduction of deductions) {
        const productId = deduction?.productoId || deduction?.productId;
        const quantity = Math.abs(finiteNumber(deduction?.cantidad ?? deduction?.quantity));
        if (!productId || quantity <= EPSILON) continue;
        addToMap(quantities, String(productId), quantity);

        const origin = String(deduction?.origen || '').trim();
        if (origin) {
            if (!origins.has(String(productId))) origins.set(String(productId), new Set());
            origins.get(String(productId)).add(origin);
        }
    }

    return { quantities, origins };
}

function mapMovementQuantities(movements = [], type = null) {
    const quantities = new Map();
    for (const movement of movements) {
        if (!movement || (type && movement.tipo !== type)) continue;
        const productId = movement.producto_id == null ? '' : String(movement.producto_id);
        if (!productId) continue;
        const quantity = type === MOVEMENT_SALE_TYPE
            ? Math.abs(finiteNumber(movement.cantidad))
            : finiteNumber(movement.cantidad);
        addToMap(quantities, productId, quantity);
    }
    return quantities;
}

function sumMap(map) {
    let total = 0;
    for (const quantity of map.values()) total += finiteNumber(quantity);
    return round2(total);
}

function getOperationMap(operations) {
    const map = new Map();
    if (!Array.isArray(operations)) return map;
    for (const operation of operations) {
        if (operation?.operationId) map.set(String(operation.operationId), operation);
    }
    return map;
}

function getSalePhysicalDeductions(sale, products, operationMap) {
    if (Array.isArray(sale?.inventoryDeductions)) {
        return { deductions: sale.inventoryDeductions, source: 'PERSISTED_CHECKOUT' };
    }
    if (Array.isArray(sale?.inventoryDeductionsApplied)) {
        return { deductions: sale.inventoryDeductionsApplied, source: 'PERSISTED_APPLIED' };
    }

    const operation = operationMap.get(`sale_${sale?.id}`);
    if (Array.isArray(operation?.transitions) && operation.transitions.length > 0) {
        return { deductions: operation.transitions, source: 'INVENTORY_OPERATION' };
    }

    const expanded = expandCartToPhysicalDeductions(sale?.items || [], products);
    return {
        deductions: expanded.deductions,
        source: 'RECONSTRUCTED_FROM_CATALOG',
        anomalies: expanded.anomalies,
    };
}

function buildMovementIndex(kardex) {
    const byProduct = new Map();
    const byReference = new Map();
    const safeKardex = Array.isArray(kardex) ? kardex.filter(Boolean) : [];

    safeKardex.forEach((movement, index) => {
        const productId = movement?.producto_id == null ? '' : String(movement.producto_id);
        if (productId) {
            if (!byProduct.has(productId)) byProduct.set(productId, []);
            byProduct.get(productId).push({ movement, index });
        }

        const referenceId = movement?.referencia_id;
        if (referenceId) {
            const key = String(referenceId);
            if (!byReference.has(key)) byReference.set(key, []);
            byReference.get(key).push(movement);
        }
    });

    return { byProduct, byReference, safeKardex };
}

function getContinuityBreaks(productMovements) {
    const chronological = [...(productMovements || [])]
        .sort((a, b) => movementTime(a.movement) - movementTime(b.movement) || a.index - b.index)
        .map(entry => entry.movement);
    const breaks = [];

    for (let index = 1; index < chronological.length; index += 1) {
        const previous = chronological[index - 1];
        const current = chronological[index];
        const previousAfter = nullableNumber(previous?.stock_despues);
        const currentBefore = nullableNumber(current?.stock_antes);
        if (previousAfter !== null && currentBefore !== null
            && Math.abs(previousAfter - currentBefore) > EPSILON) {
            breaks.push({
                previousMovementId: previous.id || null,
                movementId: current.id || null,
                previousAfter,
                currentBefore,
            });
        }
    }

    return { chronological, breaks };
}

function movementTotals(movements) {
    const totals = {
        saleOut: 0,
        returnsIn: 0,
        purchasesIn: 0,
        adjustmentsNet: 0,
        otherNet: 0,
    };

    for (const movement of movements || []) {
        const quantity = finiteNumber(movement?.cantidad);
        if (movement?.tipo === MOVEMENT_SALE_TYPE) totals.saleOut += Math.abs(quantity);
        else if (movement?.tipo === MOVEMENT_RETURN_TYPE) totals.returnsIn += quantity;
        else if (movement?.tipo === 'COMPRA' || movement?.tipo === 'INICIAL') totals.purchasesIn += quantity;
        else if (movement?.tipo === 'AJUSTE' || movement?.tipo === 'ENTRADA' || movement?.tipo === 'SALIDA') totals.adjustmentsNet += quantity;
        else totals.otherNet += quantity;
    }

    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round2(value)]));
}

function getProductAction(alertCodes, hasBase, hasMissingSales) {
    if (!hasBase) return 'OBTENER_SNAPSHOT_O_CONTEO_FISICO';
    if (alertCodes.includes(PRODUCT_ALERT_CODES.MODULAR_NOT_REFLECTED)) return 'REVISAR_COMPOSICION_HISTORICA';
    if (alertCodes.length > 0 || hasMissingSales) return 'NO_AJUSTAR_AUTOMATICAMENTE';
    return 'SIN_ACCION';
}

function confidenceFor(alertCodes, hasBase, continuityBreaks) {
    if (!hasBase) return 'NO_CALCULABLE';
    if (alertCodes.length > 0 || continuityBreaks > 0) return 'BAJA';
    return 'MEDIA';
}

function csvCell(value) {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}

export const HISTORICAL_AUDIT_CSV_HEADERS = Object.freeze([
    'Producto ID',
    'Producto',
    'Stock actual',
    'Último stock Kardex',
    'Diferencia stock actual vs Kardex',
    'Salidas Kardex VENTA',
    'Venta física esperada',
    'Componentes modulares esperados',
    'Componentes modulares no reflejados',
    'Ventas sin Kardex',
    'Devoluciones',
    'Saltos continuidad',
    'Confianza',
    'Alertas',
    'Acción dry-run',
    'Requiere conteo físico',
]);

/**
 * Ejecuta una conciliación histórica sin modificar productos, ventas ni Kardex.
 * Todas las acciones devueltas son propuestas informativas de dry-run.
 */
export function buildHistoricalInventoryDryRun({
    products = [],
    sales = [],
    kardex = [],
    operations = [],
    missingDocIds = [],
} = {}) {
    const safeProducts = Array.isArray(products) ? products.filter(Boolean) : [];
    const safeSales = Array.isArray(sales) ? sales.filter(Boolean) : [];
    const operationMap = getOperationMap(operations);
    const { byProduct, byReference, safeKardex } = buildMovementIndex(kardex);
    const expectedByProduct = new Map();
    const modularExpectedByProduct = new Map();
    const missingByProduct = new Map();
    const missingSaleCountByProduct = new Map();
    const saleFindings = [];
    const saleSources = new Map();
    let completedSales = 0;
    let voidedSales = 0;
    let modularSales = 0;
    let virtualSales = 0;
    let salesWithoutKardex = 0;
    let voidsWithNetDifference = 0;

    for (const sale of safeSales) {
        if (!SALE_TYPES.has(sale?.tipo)) continue;
        if (!hasPhysicalItems(sale)) {
            virtualSales += 1;
            continue;
        }

        const isVoided = sale.status === 'ANULADA';
        if (isVoided) voidedSales += 1;
        else completedSales += 1;
        if ((sale.items || []).some(item => item?.isModular || item?.isCombo)) modularSales += 1;

        const physical = getSalePhysicalDeductions(sale, safeProducts, operationMap);
        const expected = mapPositiveDeductions(physical.deductions);
        const saleMovements = byReference.get(String(sale.id)) || [];
        const saleOut = mapMovementQuantities(saleMovements, MOVEMENT_SALE_TYPE);
        const returns = mapMovementQuantities(saleMovements, MOVEMENT_RETURN_TYPE);
        const expectedTotal = sumMap(expected.quantities);
        const saleOutTotal = sumMap(saleOut);

        saleSources.set(String(sale.id), physical.source);
        for (const [productId, quantity] of expected.quantities) {
            addToMap(expectedByProduct, productId, quantity);
            const productOrigins = expected.origins.get(productId) || new Set();
            if ([...productOrigins].some(origin => origin.includes('MODULAR'))) {
                addToMap(modularExpectedByProduct, productId, quantity);
            }
        }

        if (expectedTotal > EPSILON && saleOutTotal <= EPSILON) {
            salesWithoutKardex += 1;
            saleFindings.push({
                code: 'SALE_WITHOUT_PHYSICAL_KARDEX',
                severity: 'ALTO',
                saleId: sale.id,
                saleNumber: sale.saleNumber || null,
                description: 'Venta con composición física esperada, pero sin salida VENTA enlazada en Kardex.',
                source: physical.source,
            });
        }

        const componentGaps = [];
        for (const [productId, expectedQuantity] of expected.quantities) {
            const actualQuantity = saleOut.get(productId) || 0;
            const gap = round2(expectedQuantity - actualQuantity);
            if (gap > EPSILON) {
                addToMap(missingByProduct, productId, gap);
                missingSaleCountByProduct.set(
                    productId,
                    (missingSaleCountByProduct.get(productId) || 0) + 1
                );
                const origins = expected.origins.get(productId) || new Set();
                componentGaps.push({
                    productoId: productId,
                    expected: expectedQuantity,
                    actual: actualQuantity,
                    missing: gap,
                    modular: [...origins].some(origin => origin.includes('MODULAR')),
                });
            }
        }

        if (componentGaps.length > 0) {
            saleFindings.push({
                code: componentGaps.some(item => item.modular)
                    ? 'MODULAR_COMPONENTS_NOT_IN_KARDEX'
                    : 'SALE_COMPOSITION_NOT_IN_KARDEX',
                severity: 'ALTO',
                saleId: sale.id,
                saleNumber: sale.saleNumber || null,
                description: 'La composición física esperada no coincide con los SKU de la salida Kardex.',
                source: physical.source,
                components: componentGaps,
            });
        }

        if (isVoided) {
            const productIds = new Set([...expected.quantities.keys(), ...saleOut.keys(), ...returns.keys()]);
            const netDifferences = [];
            for (const productId of productIds) {
                const net = round2((saleOut.get(productId) || 0) - (returns.get(productId) || 0));
                if (Math.abs(net) > EPSILON) {
                    netDifferences.push({ productoId: productId, saldoNeto: net });
                }
            }
            if (netDifferences.length > 0) {
                voidsWithNetDifference += 1;
                saleFindings.push({
                    code: 'VOID_WITH_NET_PHYSICAL_DIFFERENCE',
                    severity: 'ALTO',
                    saleId: sale.id,
                    saleNumber: sale.saleNumber || null,
                    description: 'La anulación no deja en cero la salida física neta de la venta.',
                    netDifferences,
                });
            }
        }
    }

    const productRows = safeProducts.map(product => {
        const productId = String(product.id);
        const indexed = byProduct.get(productId) || [];
        const { chronological, breaks } = getContinuityBreaks(indexed);
        const lastMovement = chronological[chronological.length - 1] || null;
        const actualStock = finiteNumber(product.stock);
        const lastKardexStock = nullableNumber(lastMovement?.stock_despues);
        const stockDifference = lastKardexStock === null ? null : round2(actualStock - lastKardexStock);
        const totals = movementTotals(chronological);
        const expectedSales = expectedByProduct.get(productId) || 0;
        const modularExpected = modularExpectedByProduct.get(productId) || 0;
        const modularMissing = missingByProduct.get(productId) || 0;
        const saleMovementCount = chronological.filter(movement => movement.tipo === MOVEMENT_SALE_TYPE).length;
        const alertCodes = [];
        const isComboParent = product.isCombo === true;

        if (actualStock < -EPSILON) alertCodes.push(PRODUCT_ALERT_CODES.NEGATIVE_STOCK);
        if (lastMovement === null) alertCodes.push(PRODUCT_ALERT_CODES.NO_KARDEX);
        if (stockDifference !== null && Math.abs(stockDifference) > EPSILON) alertCodes.push(PRODUCT_ALERT_CODES.STOCK_MISMATCH);
        if (breaks.length > 0) alertCodes.push(PRODUCT_ALERT_CODES.BROKEN_CONTINUITY);
        if (expectedSales > totals.saleOut + EPSILON) alertCodes.push(PRODUCT_ALERT_CODES.SALE_NOT_REFLECTED);
        if (modularMissing > EPSILON) alertCodes.push(PRODUCT_ALERT_CODES.MODULAR_NOT_REFLECTED);
        if (isComboParent && saleMovementCount > 0) alertCodes.push(PRODUCT_ALERT_CODES.PARENT_IN_KARDEX);

        const action = getProductAction(alertCodes, lastMovement !== null, expectedSales > totals.saleOut + EPSILON);
        const requiresPhysicalCount = action !== 'SIN_ACCION';

        return {
            productoId: product.id,
            producto: product.name || product.id,
            isComboParent,
            stockActual: actualStock,
            ultimoStockKardex: lastKardexStock,
            diferenciaStock: stockDifference,
            salidasKardexVenta: totals.saleOut,
            ventaFisicaEsperada: round2(expectedSales),
            componentesModularesEsperados: round2(modularExpected),
            componentesModularesNoReflejados: round2(modularMissing),
            ventasSinKardex: missingSaleCountByProduct.get(productId) || 0,
            devoluciones: totals.returnsIn,
            saltosContinuidad: breaks.length,
            movimientosKardex: chronological.length,
            confianza: confidenceFor(alertCodes, lastMovement !== null, breaks.length),
            alertas: alertCodes,
            accionDryRun: action,
            requiereConteoFisico: requiresPhysicalCount,
            plan: {
                modo: 'DRY_RUN',
                mutaDatos: false,
                accion: action,
                deltaPropuesto: null,
                motivo: alertCodes.length > 0 ? alertCodes.join(';') : 'SIN_ALERTAS',
            },
        };
    });

    const productFindings = productRows
        .filter(row => row.alertas.length > 0)
        .flatMap(row => row.alertas.map(code => ({
            code,
            severity: code === PRODUCT_ALERT_CODES.NO_KARDEX || code === PRODUCT_ALERT_CODES.NEGATIVE_STOCK ? 'ALTO' : 'MEDIO',
            productoId: row.productoId,
            producto: row.producto,
            description: `Producto ${row.producto}: ${code}.`,
        })));

    const discrepancies = [...saleFindings, ...productFindings];
    const pendingOperations = (Array.isArray(operations) ? operations : [])
        .filter(operation => operation?.status === 'PENDING' || operation?.status === 'FAILED_RETRYABLE');
    const productsWithoutKardex = productRows.filter(row => row.alertas.includes(PRODUCT_ALERT_CODES.NO_KARDEX)).length;
    const stockMismatches = productRows.filter(row => row.alertas.includes(PRODUCT_ALERT_CODES.STOCK_MISMATCH)).length;
    const continuityBreaks = productRows.reduce((sum, row) => sum + row.saltosContinuidad, 0);
    const modularMissingProducts = productRows.filter(row => row.componentesModularesNoReflejados > EPSILON).length;
    const negativeProducts = productRows.filter(row => row.alertas.includes(PRODUCT_ALERT_CODES.NEGATIVE_STOCK)).length;
    const incomplete = (Array.isArray(missingDocIds) && missingDocIds.length > 0) || productsWithoutKardex > 0;

    return {
        status: discrepancies.length === 0 ? 'OK' : (incomplete ? 'INCOMPLETE' : 'REVIEW'),
        dryRun: true,
        mutatesData: false,
        sourceCoverage: {
            products: safeProducts.length,
            sales: safeSales.length,
            kardex: safeKardex.length,
            operations: Array.isArray(operations) ? operations.length : 0,
            missingDocIds: Array.isArray(missingDocIds) ? [...missingDocIds] : [],
        },
        summary: {
            products: safeProducts.length,
            sales: safeSales.length,
            completedSales,
            voidedSales,
            modularSales,
            virtualSales,
            salesWithoutKardex,
            voidsWithNetDifference,
            productsWithoutKardex,
            stockMismatches,
            continuityBreaks,
            modularMissingProducts,
            negativeProducts,
            pendingOperations: pendingOperations.length,
            discrepancies: discrepancies.length,
        },
        products: productRows,
        saleFindings,
        discrepancies,
        pendingOperations,
        repairPlan: productRows.map(row => row.plan),
        saleSources: Object.fromEntries(saleSources),
    };
}

/** Genera el CSV de propuestas del dry-run para revisión en Excel. */
export function buildHistoricalInventoryCsv(report) {
    const rows = Array.isArray(report?.products) ? report.products.map(row => [
        row.productoId,
        row.producto,
        row.stockActual,
        row.ultimoStockKardex,
        row.diferenciaStock,
        row.salidasKardexVenta,
        row.ventaFisicaEsperada,
        row.componentesModularesEsperados,
        row.componentesModularesNoReflejados,
        row.ventasSinKardex,
        row.devoluciones,
        row.saltosContinuidad,
        row.confianza,
        row.alertas.join(';'),
        row.accionDryRun,
        row.requiereConteoFisico ? 'SI' : 'NO',
    ]) : [];

    return [
        HISTORICAL_AUDIT_CSV_HEADERS.map(csvCell).join(','),
        ...rows.map(row => row.map(csvCell).join(',')),
    ].join('\n');
}

export { PRODUCT_ALERT_CODES };
