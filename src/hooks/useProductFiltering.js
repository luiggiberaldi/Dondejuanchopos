import { useMemo, useDeferredValue } from 'react';
import { matchProductSearch } from '../utils/searchUtils';

export function useProductFiltering(products, searchTerm, activeCategory, sortField, sortDir, effectiveRate) {
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const filteredProducts = useMemo(() => {
        let result = products.filter(p => {
            const hasTerm = Boolean(deferredSearchTerm && deferredSearchTerm.trim());
            const matchesSearch = hasTerm ? matchProductSearch(p, deferredSearchTerm) : true;
            if (activeCategory === 'bajo-stock') {
                return matchesSearch && (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
            }
            const matchesCategory = activeCategory === 'todos' || p.category === activeCategory;
            return matchesSearch && matchesCategory;
        });

        // Apply sort if active
        if (sortField) {
            result = [...result].sort((a, b) => {
                let valA, valB;
                switch (sortField) {
                    case 'name': valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break;
                    case 'price': valA = a.priceUsdt || 0; valB = b.priceUsdt || 0; break;
                    case 'stock': valA = a.stock ?? 0; valB = b.stock ?? 0; break;
                    case 'margin':
                        valA = a.costBs > 0 ? ((a.priceUsdt * effectiveRate - a.costBs) / a.costBs * 100) : -999;
                        valB = b.costBs > 0 ? ((b.priceUsdt * effectiveRate - b.costBs) / b.costBs * 100) : -999;
                        break;
                    default: valA = 0; valB = 0;
                }
                if (valA < valB) return sortDir === 'asc' ? -1 : 1;
                if (valA > valB) return sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return result;
    }, [products, deferredSearchTerm, activeCategory, sortField, sortDir, effectiveRate]);

    return { filteredProducts };
}
