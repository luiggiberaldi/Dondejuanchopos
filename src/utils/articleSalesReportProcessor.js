import { mulR, sumR, round2, divR } from './dinero';

/**
 * Formatea cualquier nombre de categoría reemplazando guiones bajos por espacios y en Title Case.
 * Ejemplo: "cerveza_botella_pilsen" -> "Cerveza Botella Pilsen"
 */
export function formatCategoryName(cat) {
    if (!cat || typeof cat !== 'string') return 'Sin Categoría';
    const cleaned = cat.replace(/_/g, ' ').trim();
    if (!cleaned) return 'Sin Categoría';
    return cleaned.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

/**
 * Recibe salesForStats (ventas del período, netas sin anuladas),
 * la lista completa de productos y los filtros activos ({ selectedCategories, selectedProductIds, search }).
 * Retorna datos agrupados por artículo, resúmenes por categoría y totales globales,
 * desglosando tanto productos individuales/cajas como la composición física de combos fijos y mixtos/modulares.
 */
export function calculateArticleSalesReport(salesForStats = [], products = [], filters = {}) {
    const {
        selectedCategories = [], // [] = Todas (nombres formateados)
        selectedProductIds = [],  // [] = Todos
        search = ''
    } = filters;

    // Mapa de productos por ID canónico y por nombre para lookup rápido
    const productMap = new Map();
    const nameMap = new Map();
    (products || []).forEach(p => {
        if (p.id) {
            const cleanPId = String(p.id).replace(/_half|_box|_unit$/, '');
            productMap.set(cleanPId, p);
            productMap.set(p.id, p);
        }
        if (p.name) {
            nameMap.set(p.name.toLowerCase().trim(), p);
        }
    });

    // Helper interno para registrar/acumular unidades en el agregador por artículo
    const articleMap = {};
    let globalTotalUsd = 0;

    const addArticleRecord = ({
        itemId,
        rawName,
        rawCategory,
        rawSku,
        qtyUnits,
        revenueUsd,
        matchedProduct
    }) => {
        const cleanItemId = String(itemId || '').replace(/_half|_box|_unit$/, '');
        const pMatch = matchedProduct || productMap.get(cleanItemId) || productMap.get(itemId) || nameMap.get((rawName || '').toLowerCase().trim());

        const category = formatCategoryName(pMatch?.category || rawCategory || 'Sin Categoría');
        const sku = pMatch?.barcode || rawSku || pMatch?.sku || 'N/A';
        const costUsd = pMatch?.costUsd || 0;
        const canonicalId = pMatch?.id || cleanItemId;
        const name = pMatch?.name || rawName || 'Artículo sin nombre';

        // Info de empaque del producto
        const boxUnits = pMatch?.boxUnits || null;
        const unitsPerPackage = (pMatch?.packagingType === 'lote' && pMatch?.unitsPerPackage > 1)
            ? pMatch.unitsPerPackage
            : null;

        const packUnits = boxUnits || unitsPerPackage || null;
        const packType = boxUnits ? 'caja' : (unitsPerPackage ? (pMatch?.unit || 'paquete') : null);

        // Filtrado por categoría (usando nombre formateado)
        if (selectedCategories.length > 0 && !selectedCategories.includes(category)) {
            return;
        }

        // Filtrado por producto ID
        if (selectedProductIds.length > 0 && !selectedProductIds.includes(canonicalId)) {
            return;
        }

        // Filtrado por texto de búsqueda
        if (search.trim() !== '') {
            const term = search.toLowerCase().trim();
            const matchesName = name.toLowerCase().includes(term);
            const matchesCat = category.toLowerCase().includes(term);
            const matchesSku = sku.toLowerCase().includes(term);
            if (!matchesName && !matchesCat && !matchesSku) return;
        }

        const itemCostUsd = mulR(costUsd, qtyUnits);
        const itemProfitUsd = round2(revenueUsd - itemCostUsd);

        if (!articleMap[canonicalId]) {
            articleMap[canonicalId] = {
                id: canonicalId,
                name,
                sku,
                category,
                qty: 0,
                revenueUsd: 0,
                costUsd: 0,
                profitUsd: 0,
                avgPriceUsd: 0,
                packUnits,
                packType,
            };
        }

        const art = articleMap[canonicalId];
        art.qty += qtyUnits;
        art.revenueUsd = round2(art.revenueUsd + revenueUsd);
        art.costUsd = round2(art.costUsd + itemCostUsd);
        art.profitUsd = round2(art.profitUsd + itemProfitUsd);

        if (art.qty > 0) {
            art.avgPriceUsd = divR(art.revenueUsd, art.qty);
        }

        globalTotalUsd = round2(globalTotalUsd + revenueUsd);
    };

    (salesForStats || []).forEach(sale => {
        if (!sale.items || !Array.isArray(sale.items)) return;

        sale.items.forEach(item => {
            const rawItemId = item._originalId || item.productId || item.id || item.name;
            const cleanItemId = String(rawItemId).replace(/_half|_box|_unit$/, '');
            const matchedProduct = productMap.get(cleanItemId) || (item.id ? productMap.get(item.id) : null) || nameMap.get((item.name || '').toLowerCase().trim());

            const rawQty = Number(item.qty) || 0;
            const priceUsd = Number(item.priceUsd) || 0;
            const itemTotalUsd = mulR(priceUsd, rawQty);

            // 1. DESGLOSE DE COMBOS MIXTOS / MODULARES (modularSelections o selectedComponents)
            const modularSelections = item.modularSelections || item.selectedComponents || item.comboSelections || [];
            if ((item.isModular || item.isCombo) && modularSelections.length > 0) {
                const totalCompUnitsInCombo = modularSelections.reduce((sum, sel) => sum + (Number(sel.qty) || 1), 0);

                modularSelections.forEach(sel => {
                    const compQtyPerCombo = Number(sel.qty) || 1;
                    const effectiveCompUnits = compQtyPerCombo * rawQty;

                    // Asignación proporcional del ingreso del combo al componente
                    const compRevenueUsd = totalCompUnitsInCombo > 0
                        ? round2((itemTotalUsd / totalCompUnitsInCombo) * compQtyPerCombo)
                        : 0;

                    addArticleRecord({
                        itemId: sel.productId || sel.id || sel.name,
                        rawName: sel.name,
                        rawCategory: sel.category || item.category,
                        rawSku: sel.barcode || sel.sku,
                        qtyUnits: effectiveCompUnits,
                        revenueUsd: compRevenueUsd,
                        matchedProduct: null,
                    });
                });
                return;
            }

            // 2. DESGLOSE DE COMBOS FIJOS (isCombo con comboItems)
            const isComboProduct = matchedProduct?.isCombo || item.isCombo;
            const comboItems = item.comboItems || matchedProduct?.comboItems || [];

            if (isComboProduct && comboItems.length > 0) {
                const totalCompUnitsInCombo = comboItems.reduce((sum, ci) => sum + (Number(ci.qty) || 1), 0);

                comboItems.forEach(ci => {
                    const compQtyPerCombo = Number(ci.qty) || 1;
                    const effectiveCompUnits = compQtyPerCombo * rawQty;

                    const compRevenueUsd = totalCompUnitsInCombo > 0
                        ? round2((itemTotalUsd / totalCompUnitsInCombo) * compQtyPerCombo)
                        : 0;

                    addArticleRecord({
                        itemId: ci.productId || ci.id || ci.name,
                        rawName: ci.name,
                        rawCategory: ci.category || item.category,
                        rawSku: ci.barcode || ci.sku,
                        qtyUnits: effectiveCompUnits,
                        revenueUsd: compRevenueUsd,
                        matchedProduct: null,
                    });
                });
                return;
            }

            // 3. PRODUCTOS REGULARES (Unidad, Caja, Media Caja, Lote)
            const boxUnits = matchedProduct?.boxUnits || item.boxUnits || null;
            const halfBoxUnits = matchedProduct?.halfBoxUnits || item.halfBoxUnits || null;
            const unitsPerPackage = (matchedProduct?.packagingType === 'lote' && matchedProduct?.unitsPerPackage > 1)
                ? matchedProduct.unitsPerPackage
                : (item.unitsPerPackage > 1 ? item.unitsPerPackage : null);

            const itemMode = item._mode || (item.id && String(item.id).endsWith('_box') ? 'box' : item.id && String(item.id).endsWith('_half') ? 'halfBox' : 'unit');

            let unitMultiplier = 1;
            if (itemMode === 'box') {
                unitMultiplier = boxUnits || 1;
            } else if (itemMode === 'halfBox') {
                unitMultiplier = halfBoxUnits || (boxUnits ? Math.round(boxUnits / 2) : 1);
            } else if (itemMode === 'pkg' || item.isPackage) {
                unitMultiplier = unitsPerPackage || 1;
            }

            const effectiveUnits = rawQty * unitMultiplier;

            addArticleRecord({
                itemId: cleanItemId,
                rawName: item.name,
                rawCategory: item.category,
                rawSku: item.barcode || item.sku,
                qtyUnits: effectiveUnits,
                revenueUsd: itemTotalUsd,
                matchedProduct,
            });
        });
    });

    const rows = Object.values(articleMap).map(art => {
        const share = globalTotalUsd > 0 ? round2((art.revenueUsd / globalTotalUsd) * 100) : 0;

        // Estructura de empaque (ej. 37.44 cajas)
        let packInfo = { hasPack: false };
        if (art.packUnits && art.packUnits > 1) {
            const packCount = round2(art.qty / art.packUnits);
            packInfo = {
                hasPack: true,
                unitsPerPack: art.packUnits,
                packType: art.packType || 'caja',
                packCount,
                text: `(${packCount.toFixed(2)} ${art.packType || 'caja'}${packCount !== 1 ? 's' : ''})`
            };
        }

        return {
            ...art,
            share,
            packInfo,
        };
    });

    // Totales acumulados
    const totalQty = rows.reduce((sum, r) => sum + r.qty, 0);
    const totalRevenueUsd = sumR(rows.map(r => r.revenueUsd));
    const totalProfitUsd = sumR(rows.map(r => r.profitUsd));

    // Resumen por categoría
    const catMap = {};
    rows.forEach(r => {
        if (!catMap[r.category]) {
            catMap[r.category] = { category: r.category, qty: 0, revenueUsd: 0, itemCount: 0 };
        }
        catMap[r.category].qty += r.qty;
        catMap[r.category].revenueUsd = round2(catMap[r.category].revenueUsd + r.revenueUsd);
        catMap[r.category].itemCount += 1;
    });

    const categorySummary = Object.values(catMap).sort((a, b) => b.revenueUsd - a.revenueUsd);

    return {
        rows,
        totals: {
            totalQty,
            totalRevenueUsd,
            totalProfitUsd,
            itemCount: rows.length,
        },
        categorySummary,
    };
}
