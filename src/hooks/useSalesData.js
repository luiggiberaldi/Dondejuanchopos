import { useState, useEffect, useCallback } from 'react';
import { storageService } from '../utils/storageService';
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
        const knownIds = new Set(salesList.map(s => s.id).filter(Boolean));

        try {
            const mirrorSales = await storageService.getItem('bodega_sales_mirror_v1', []);
            if (Array.isArray(mirrorSales)) {
                for (const s of mirrorSales) {
                    if (s && s.id && !knownIds.has(s.id)) {
                        salesList.push(s);
                        knownIds.add(s.id);
                        healed = true;
                    }
                }
            }

            const autoBackup = await storageService.getItem('bodega_autobackup_v1', null);
            if (autoBackup?.data?.idb?.bodega_sales_v1 && Array.isArray(autoBackup.data.idb.bodega_sales_v1)) {
                for (const s of autoBackup.data.idb.bodega_sales_v1) {
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
            salesList.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
            await storageService.setItem(SALES_KEY, salesList);
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
