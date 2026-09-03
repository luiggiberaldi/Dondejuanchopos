import { useState, useEffect, useRef, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';

const SALES_KEY = 'bodega_sales_v1';

export function useDashboardData(isActive, requestPermission) {
    const [sales, setSales] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(true);
    const hasRequestedPermRef = useRef(false);

    const load = useCallback(async () => {
        const [savedSales, savedCustomers] = await Promise.all([
            storageService.getItem(SALES_KEY, []),
            storageService.getItem('bodega_customers_v1', []),
        ]);

        let salesList = Array.isArray(savedSales) ? savedSales : [];
        const activeApertura = salesList.find(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
        const activeFrom = activeApertura?.timestamp ? new Date(activeApertura.timestamp).getTime() : null;

        let healed = false;
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

        if (healed) {
            await withLock('pos_write_lock', async () => {
                const freshSales = await storageService.getItem(SALES_KEY, []) || [];
                const freshMap = new Map(freshSales.map(s => [s.id, s]));
                for (const h of salesList) {
                    if (freshMap.has(h.id)) {
                        freshMap.set(h.id, { ...freshMap.get(h.id), ...h });
                    } else {
                        freshMap.set(h.id, h);
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

        setSales(salesList);
        setCustomers(savedCustomers);
        setIsLoadingLocal(false);
    }, []);

    // Cargar al activarse la pestaña
    useEffect(() => {
        if (!isActive) return;
        load();
        
        // Solicitar permiso de notificaciones al primer uso
        if (!hasRequestedPermRef.current) { 
            hasRequestedPermRef.current = true; 
            requestPermission(); 
        }
    }, [isActive, load, requestPermission]);

    // Escuchar actualizaciones de ventas en caliente
    useEffect(() => {
        const handleUpdate = () => {
            load();
        };

        const handleStorageChange = (e) => {
            if (e.key === SALES_KEY || e.key === 'bodega_customers_v1') {
                load();
            }
        };

        window.addEventListener('sales-updated', handleUpdate);
        window.addEventListener('storage', handleStorageChange);

        return () => {
            window.removeEventListener('sales-updated', handleUpdate);
            window.removeEventListener('storage', handleStorageChange);
        };
    }, [load]);

    const refreshData = async (setProducts) => {
        const [savedSales, savedProducts, savedCustomers] = await Promise.all([
            storageService.getItem(SALES_KEY, []),
            storageService.getItem('bodega_products_v1', []),
            storageService.getItem('bodega_customers_v1', []),
        ]);
        setSales(savedSales);
        setProducts(savedProducts);
        setCustomers(savedCustomers);
    };

    return { sales, setSales, customers, setCustomers, isLoadingLocal, refreshData };
}
