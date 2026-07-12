import { useState, useEffect, useRef, useCallback } from 'react';
import { storageService } from '../utils/storageService';

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
        setSales(savedSales);
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
