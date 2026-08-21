import { useState, useMemo, useEffect } from 'react';
import { calculateComboStock, getEffectiveCostUsd } from '../utils/productProcessor';
import { applyProjectedStock } from '../utils/supervisorStockProjection';

const ITEMS_PER_PAGE_INVENTARIO = 15;

/**
 * Estado y derivados del catálogo de inventario del Monitor de Supervisión.
 * Recibe la cola de cambios del hook de comandos para proyectar stock en memoria.
 */
export function useMonitorInventory({ products, pendingChanges, inFlightChanges, recentlyConfirmedIds }) {
    const [searchTermInventario, setSearchTermInventario] = useState('');
    const [filterStockInventario, setFilterStockInventario] = useState('todos'); // 'todos', 'bajo', 'agotado'
    const [currentPageInventario, setCurrentPageInventario] = useState(1);
    const [showRemoteForm, setShowRemoteForm] = useState(false);
    const [remoteEditingProduct, setRemoteEditingProduct] = useState(null);
    const [showComboModal, setShowComboModal] = useState(false);
    const [editingCombo, setEditingCombo] = useState(null);
    const [remoteDeleteTarget, setRemoteDeleteTarget] = useState(null);
    const [stockAdjustProduct, setStockAdjustProduct] = useState(null);
    const [stockAlertTab, setStockAlertTab] = useState('agotados'); // 'agotados' | 'critico'

    // Proyección instantánea en memoria de los productos + cambios en cola
    const projectedProducts = useMemo(() => {
        if (!products) return [];

        const allProjectedChanges = [...inFlightChanges, ...pendingChanges];
        const baseList = products.map(p => {
            const stockChanges = allProjectedChanges
                .filter(c => c.productId === p.id && c.action === 'adjust_stock');
            const baseStockValue = Number(p.stock) || 0;
            const projectedStock = applyProjectedStock(baseStockValue, stockChanges);
            const stockDelta = projectedStock - baseStockValue;

            const productEdits = allProjectedChanges
                .filter(c => c.productId === p.id && c.action === 'edit')
                .sort((a, b) => String(a.queuedAt || a.sentAt || '').localeCompare(String(b.queuedAt || b.sentAt || '')));
            const editChange = productEdits[productEdits.length - 1];
            const isDeleted = allProjectedChanges.some(c => c.productId === p.id && c.action === 'delete');

            let merged = { ...p };
            if (editChange?.data) {
                merged = { ...merged, ...editChange.data };
            }

            const isLocalPending = pendingChanges.some(c => String(c.productId) === String(p.id));
            const isInFlight = inFlightChanges.some(c => String(c.productId) === String(p.id));
            const isRecentlyConfirmed = recentlyConfirmedIds.has(String(p.id));

            const baseStock = Number(merged.stock) || 0;
            return {
                ...merged,
                stock: projectedStock,
                _rawStock: baseStock,
                _stockDelta: stockDelta,
                _isQueuedDelete: isDeleted,
                _isQueuedEdit: !!editChange,
                _isLocalPending: isLocalPending,
                _isInFlight: isInFlight,
                _isPendingSync: isLocalPending || isInFlight,
                _isRecentlyConfirmed: isRecentlyConfirmed,
            };
        });

        // Excluir de la vista los eliminados en cola
        const activeList = baseList.filter(p => !p._isQueuedDelete);

        // Agregar a la vista los creados en cola (nuevos)
        const addChanges = allProjectedChanges.filter(c => c.action === 'add');
        const newItems = addChanges.filter(c => c.data).map(addChange => {
            const tempId = addChange.productId || addChange.data.id || `temp_${Date.now()}`;
            const isAddInFlight = inFlightChanges.some(c => c.action === 'add' && String(c.productId || c.data?.id) === String(tempId));
            return {
                ...addChange.data,
                id: tempId,
                name: addChange.data.name || 'Nuevo Producto',
                category: addChange.data.category || 'Varios',
                stock: Number(addChange.data.stock || 0),
                priceUsd: Number(addChange.data.priceUsd || addChange.data.price || 0),
                costUsd: Number(addChange.data.costUsd || addChange.data.costPrice || 0),
                _isQueuedNew: true,
                _isLocalPending: !isAddInFlight,
                _isInFlight: isAddInFlight,
                _isPendingSync: true,
                _isRecentlyConfirmed: recentlyConfirmedIds.has(String(tempId)),
            };
        });

        const combinedList = [...newItems, ...activeList];

        // Recalcular stock dinámico y costo efectivo para combos basándonos en la proyección de sus insumos
        return combinedList.map(p => {
            const effCost = getEffectiveCostUsd(p, combinedList);
            if (p.isCombo || p.type === 'combo' || p.category === 'combo') {
                const dynamicStock = calculateComboStock(p, combinedList);
                return { ...p, stock: dynamicStock, _isCombo: true, _effectiveCost: effCost, costUsd: p.costUsd || effCost };
            }
            return { ...p, _effectiveCost: effCost, costUsd: p.costUsd || effCost };
        });
    }, [products, pendingChanges, inFlightChanges, recentlyConfirmedIds]);

    const filteredProducts = useMemo(() => {
        return projectedProducts.filter(p => {
            const matchesSearch = (p.name || '').toLowerCase().includes(searchTermInventario.toLowerCase()) ||
                                 (p.barcode && p.barcode.includes(searchTermInventario));

            if (!matchesSearch) return false;

            if (filterStockInventario === 'bajo') {
                return p.stock > 0 && p.stock <= (p.minStock || 5);
            }
            if (filterStockInventario === 'agotado') {
                return p.stock <= 0;
            }
            return true;
        });
    }, [projectedProducts, searchTermInventario, filterStockInventario]);

    useEffect(() => {
        setCurrentPageInventario(1);
    }, [searchTermInventario, filterStockInventario]);

    const totalPagesInventario = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE_INVENTARIO);

    const paginatedProducts = useMemo(() => {
        const start = (currentPageInventario - 1) * ITEMS_PER_PAGE_INVENTARIO;
        return filteredProducts.slice(start, start + ITEMS_PER_PAGE_INVENTARIO);
    }, [filteredProducts, currentPageInventario]);

    const inventoryMetrics = useMemo(() => {
        if (!projectedProducts) {
            return { totalCost: 0, totalRetail: 0, totalQty: 0, lowStockCount: 0, outOfStockCount: 0, expectedProfit: 0, count: 0 };
        }
        let totalCost = 0;
        let totalRetail = 0;
        let totalQty = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;

        projectedProducts.forEach(p => {
            const stock = p.stock || 0;
            const cost = p._effectiveCost ?? (p.costUsd || p.costPrice || 0);
            const retail = p.priceUsd || 0;
            const minStock = p.minStock || 5;

            totalCost += cost * stock;
            totalRetail += retail * stock;
            totalQty += stock;

            if (stock <= 0) {
                outOfStockCount++;
            } else if (stock <= minStock) {
                lowStockCount++;
            }
        });

        const expectedProfit = Math.max(0, totalRetail - totalCost);

        return {
            totalCost,
            totalRetail,
            totalQty,
            lowStockCount,
            outOfStockCount,
            expectedProfit,
            count: projectedProducts.length
        };
    }, [projectedProducts]);

    // 🚫 Productos Agotados (Stock <= 0)
    const outOfStockProducts = useMemo(() => {
        return products.filter(p => (p.stock || 0) <= 0);
    }, [products]);

    // ⚠️ Stock Crítico (Stock > 0 && Stock <= minStock)
    const lowStockProducts = useMemo(() => {
        return products.filter(p => {
            const stock = Number(p.stock) || 0;
            const minStock = Number(p.minStock ?? p.min_stock ?? 5);
            return stock > 0 && stock <= minStock;
        });
    }, [products]);

    // Guarda-rail 1: Auto-selección inteligente de pestaña de alertas si una categoría está vacía
    const activeStockAlertTab = useMemo(() => {
        if (stockAlertTab === 'agotados' && outOfStockProducts.length === 0 && lowStockProducts.length > 0) {
            return 'critico';
        }
        if (stockAlertTab === 'critico' && lowStockProducts.length === 0 && outOfStockProducts.length > 0) {
            return 'agotados';
        }
        return stockAlertTab;
    }, [stockAlertTab, outOfStockProducts.length, lowStockProducts.length]);

    return {
        searchTermInventario,
        setSearchTermInventario,
        filterStockInventario,
        setFilterStockInventario,
        currentPageInventario,
        setCurrentPageInventario,
        totalPagesInventario,
        projectedProducts,
        filteredProducts,
        paginatedProducts,
        inventoryMetrics,
        stockAlertTab,
        setStockAlertTab,
        outOfStockProducts,
        lowStockProducts,
        activeStockAlertTab,
        showRemoteForm,
        setShowRemoteForm,
        remoteEditingProduct,
        setRemoteEditingProduct,
        showComboModal,
        setShowComboModal,
        editingCombo,
        setEditingCombo,
        remoteDeleteTarget,
        setRemoteDeleteTarget,
        stockAdjustProduct,
        setStockAdjustProduct,
    };
}
