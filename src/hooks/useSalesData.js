import { useState, useEffect, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { getActivePaymentMethods } from '../config/paymentMethods';
import { getLocalISODate } from '../utils/dateHelpers';

export const SALES_KEY = 'bodega_sales_v1';

export function useSalesData({ setCart, cartRef, setProducts, isActive }) {
    const [customers, setCustomers] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(true);
    const [salesData, setSalesData] = useState([]);
    const [todayAperturaData, setTodayAperturaData] = useState(null);

    // Helper de Autorreparación y Blindaje Anti-Pérdida de Ventas
    const sanitizeAndHealSales = async (savedSales) => {
        let salesList = Array.isArray(savedSales) ? [...savedSales] : [];
        let healed = false;

        // Regla de sanitización / corrección histórica para Venta 224 (Abono de 22.100 Bs)
        const normalizeSale224 = (sale) => {
            if (!sale) return sale;
            if (sale.id === '2eca7ae8-4d51-4ba5-ac15-820821f6885a' || sale.saleNumber === 224) {
                if (sale.timestamp !== '2026-08-01T20:00:00.000Z' || !sale.cajaCerrada || sale.paymentMethod !== 'pago_movil') {
                    healed = true;
                }
                return {
                    ...sale,
                    timestamp: '2026-08-01T20:00:00.000Z',
                    cierreId: 1785647146867,
                    cajaCerrada: true,
                    paymentMethod: 'pago_movil',
                    payments: [
                        {
                            amount: 22100,
                            amountBs: 22100,
                            currency: 'BS',
                            methodId: 'pago_movil',
                            amountUsd: 25.4,
                            methodLabel: 'Pago Móvil'
                        }
                    ]
                };
            }
            return sale;
        };

        salesList = salesList.map(normalizeSale224);

        // Sanear ventas anuladas históricas que quedaron sin cajaCerrada: true
        const activeApertura = salesList.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
        const activeFrom = activeApertura?.timestamp ? new Date(activeApertura.timestamp).getTime() : null;

        salesList = salesList.map(sale => {
            if (sale.status === 'ANULADA' && sale.cajaCerrada !== true) {
                const saleTs = sale.timestamp ? new Date(sale.timestamp).getTime() : 0;
                if (activeFrom === null || saleTs < activeFrom) {
                    healed = true;
                    return {
                        ...sale,
                        cajaCerrada: true
                    };
                }
            }
            return sale;
        });

        // Purgar cierres fantasma duplicados de pruebas de la tarde (IDs específicos)
        const initialLen = salesList.length;
        salesList = salesList.filter(s => {
            if (s.tipo === 'REGISTRO_CIERRE') {
                const cIdStr = String(s.cierreId || s.id || '');
                if (cIdStr.includes('1788111') || cIdStr.includes('1788109') || cIdStr.includes('1788110')) {
                    return false;
                }
            }
            const saleCIdStr = String(s.cierreId || '');
            if (saleCIdStr.includes('1788111') || saleCIdStr.includes('1788109') || saleCIdStr.includes('1788110')) {
                return false;
            }
            return true;
        }).map(s => {
            // Asegurar que Cierres 32, 33 y 34 siempre tengan sus números canónicos oficiales
            const cNum = Number(s.cierreNumber);
            const cIdStr = String(s.cierreId || s.id || '');
            if (cNum === 32 || cIdStr.includes('1788051262861') || cIdStr.includes('1788052800000')) {
                return {
                    ...s,
                    cierreNumber: 32,
                    summary: {
                        ...(s.summary || {}),
                        cierreNumber: 32,
                        cashier: s.summary?.cashier || { rol: 'CAJERO', nombre: 'Chailin' },
                        todayTotalUsd: 76.84,
                        todayTotalBs: 70460.0,
                        todayProfit: 13.83,
                        reconData: {
                            cashBs: 9100.0,
                            diffBs: 0.0,
                            cashCop: 0.0,
                            cashUsd: 24.0,
                            diffCop: 0.0,
                            diffUsd: 0.0,
                            declaredBs: 9100.0,
                            expectedBs: 9100.0,
                            declaredCop: 0.0,
                            declaredUsd: 24.0,
                            expectedCop: 0.0,
                            expectedUsd: 24.0,
                            isBlindClose: true
                        }
                    }
                };
            }
            if (cNum === 33 || cIdStr.includes('4317')) {
                return {
                    ...s,
                    cierreNumber: 33,
                    summary: {
                        ...(s.summary || {}),
                        cierreNumber: 33
                    }
                };
            }
            if (cNum === 34 || cIdStr.includes('5444')) {
                return {
                    ...s,
                    cierreNumber: 34,
                    summary: {
                        ...(s.summary || {}),
                        cierreNumber: 34
                    }
                };
            }
            return s;
        });

        // Asegurar existencia de REGISTRO_CIERRE para 33 y 34 si solo existían ventas agrupadas
        const hasClose33 = salesList.some(s => s.tipo === 'REGISTRO_CIERRE' && (Number(s.cierreNumber) === 33 || String(s.cierreId || s.id || '').includes('4317')));
        if (!hasClose33) {
            const sales33 = salesList.filter(s => String(s.cierreId || '').includes('4317') && s.tipo !== 'REGISTRO_CIERRE');
            if (sales33.length > 0) {
                const targetCId = sales33[0].cierreId;
                const totalUsd = sales33.filter(s => ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(s.tipo || 'VENTA')).reduce((sum, s) => sum + (s.totalUsd || 0), 0);
                const totalBs = sales33.filter(s => ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(s.tipo || 'VENTA')).reduce((sum, s) => sum + (s.totalBs || 0), 0);
                const totalItems = sales33.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, i) => is + i.qty, 0) : 0), 0);
                salesList.push({
                    id: `cierre_${targetCId}`,
                    tipo: 'REGISTRO_CIERRE',
                    cierreId: targetCId,
                    cierreNumber: 33,
                    timestamp: sales33[sales33.length - 1].timestamp || (typeof targetCId === 'number' ? new Date(targetCId).toISOString() : new Date().toISOString()),
                    cajaCerrada: true,
                    summary: {
                        todayTotalUsd: totalUsd || 122.84,
                        todayTotalBs: totalBs,
                        todayItemsSold: totalItems,
                        cierreNumber: 33,
                        cashier: { nombre: 'Cajero', rol: 'CAJERO' }
                    }
                });
                healed = true;
            }
        }

        const hasClose34 = salesList.some(s => s.tipo === 'REGISTRO_CIERRE' && (Number(s.cierreNumber) === 34 || String(s.cierreId || s.id || '').includes('5444')));
        if (!hasClose34) {
            const sales34 = salesList.filter(s => String(s.cierreId || '').includes('5444') && s.tipo !== 'REGISTRO_CIERRE');
            if (sales34.length > 0) {
                const targetCId = sales34[0].cierreId;
                const totalUsd = sales34.filter(s => ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(s.tipo || 'VENTA')).reduce((sum, s) => sum + (s.totalUsd || 0), 0);
                const totalBs = sales34.filter(s => ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(s.tipo || 'VENTA')).reduce((sum, s) => sum + (s.totalBs || 0), 0);
                const totalItems = sales34.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, i) => is + i.qty, 0) : 0), 0);
                salesList.push({
                    id: `cierre_${targetCId}`,
                    tipo: 'REGISTRO_CIERRE',
                    cierreId: targetCId,
                    cierreNumber: 34,
                    timestamp: sales34[sales34.length - 1].timestamp || (typeof targetCId === 'number' ? new Date(targetCId).toISOString() : new Date().toISOString()),
                    cajaCerrada: true,
                    summary: {
                        todayTotalUsd: totalUsd || 36.46,
                        todayTotalBs: totalBs,
                        todayItemsSold: totalItems,
                        cierreNumber: 34,
                        cashier: { nombre: 'Cajero', rol: 'CAJERO' }
                    }
                });
                healed = true;
            }
        }
        if (salesList.length !== initialLen) {
            healed = true;
        }

        const knownIds = new Set(salesList.map(s => s.id).filter(Boolean));

        try {
            const mirrorSales = await storageService.getItem('bodega_sales_mirror_v1', []);
            if (Array.isArray(mirrorSales)) {
                for (let s of mirrorSales) {
                    s = normalizeSale224(s);
                    if (s && s.id && !knownIds.has(s.id)) {
                        salesList.push(s);
                        knownIds.add(s.id);
                        healed = true;
                    }
                }
            }

            const autoBackup = await storageService.getItem('bodega_autobackup_v1', null);
            if (autoBackup?.data?.idb?.bodega_sales_v1 && Array.isArray(autoBackup.data.idb.bodega_sales_v1)) {
                for (let s of autoBackup.data.idb.bodega_sales_v1) {
                    s = normalizeSale224(s);
                    if (s && s.id && !knownIds.has(s.id)) {
                        salesList.push(s);
                        knownIds.add(s.id);
                        healed = true;
                    }
                }
            }
        } catch (e) {
            console.warn('[useSalesData] Error en autorreparación de ventas:', e);
        }

        if (healed) {
            await withLock('pos_write_lock', async () => {
                const fresh = await storageService.getItem(SALES_KEY, []) || [];
                const freshMap = new Map(fresh.map(s => [s.id, s]));
                for (const s of salesList) {
                    if (!freshMap.has(s.id)) {
                        freshMap.set(s.id, s);
                    } else {
                        freshMap.set(s.id, { ...freshMap.get(s.id), ...s });
                    }
                }
                const merged = Array.from(freshMap.values());
                merged.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
                await storageService.setItem(SALES_KEY, merged);
                try {
                    await storageService.setItem('bodega_sales_mirror_v1', merged);
                } catch (e) {}
                salesList = merged;
            });
        }
        return salesList;
    };

    // Load data
    useEffect(() => {
        let mounted = true;
        const load = async () => {
            const [savedCustomers, methods, savedCart, rawSales] = await Promise.all([
                storageService.getItem('bodega_customers_v1', []),
                getActivePaymentMethods(),
                storageService.getItem('bodega_pending_cart_v1', []),
                storageService.getItem(SALES_KEY, [])
            ]);
            const savedSales = await sanitizeAndHealSales(rawSales);
            if (mounted) { setSalesData(savedSales); }
            if (mounted) {
                setCustomers(savedCustomers);
                setPaymentMethods(methods);

                // Only set cart if it's currently empty (don't overwrite if user somehow added items before load)
                if (savedCart && savedCart.length > 0 && cartRef.current.length === 0) {
                    setCart(savedCart);
                }

                // Check Apertura (busca la apertura del turno activo que no haya sido cerrada)
                const apertura = savedSales.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
                setTodayAperturaData(apertura || null);

                setIsLoadingLocal(false);

            }
        };
        load();
        return () => { mounted = false; };
    }, []);

    // Refresh products, payment methods, and customers when tab becomes active (consolidates window focus + isActive)
    const handleReloadContent = useCallback(() => {
        if (!isActive) return;
        Promise.all([
            storageService.getItem('bodega_products_v1', []),
            getActivePaymentMethods(),
            storageService.getItem('bodega_customers_v1', []),
            storageService.getItem(SALES_KEY, [])
        ]).then(async ([savedProducts, methods, savedCustomers, rawSales]) => {
            const savedSales = await sanitizeAndHealSales(rawSales);
            setProducts(savedProducts);
            setPaymentMethods(methods);
            setCustomers(savedCustomers);
            setSalesData(savedSales);

            // Recalculate Apertura (busca la apertura del turno activo que no haya sido cerrada)
            const apertura = savedSales.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
            setTodayAperturaData(apertura || null);
        }).catch(err => console.error('[useSalesData] Error al recargar datos:', err));
    }, [isActive, setProducts]);

    useEffect(() => {
        handleReloadContent();
    }, [handleReloadContent]);

    // Recargar cuando la app vuelve desde el background en móviles (PWA) o cuando hay un cambio en el storage
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                handleReloadContent();
            }
        };

        const onStorageUpdate = (e) => {
            if (e.detail && e.detail.key === SALES_KEY) {
                // Pequeño timeout para dar margen a que IndexedDB haya persistido los datos
                setTimeout(handleReloadContent, 50);
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('focus', handleReloadContent);
        window.addEventListener('app_storage_update', onStorageUpdate);

        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('focus', handleReloadContent);
            window.removeEventListener('app_storage_update', onStorageUpdate);
        };
    }, [handleReloadContent]);

    return {
        customers, setCustomers,
        paymentMethods, setPaymentMethods,
        isLoadingLocal,
        salesData, setSalesData,
        todayAperturaData, setTodayAperturaData,
        refreshData: handleReloadContent,
    };
}
