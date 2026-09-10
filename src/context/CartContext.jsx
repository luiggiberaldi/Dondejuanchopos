import React, { createContext, useContext, useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { showToast } from '../components/Toast';

// HOOK-006: CartContext es la ÚNICA fuente de verdad del carrito.
// Antes había estado duplicado en `useAppStore` (Zustand) y aquí mismo;
// la versión Zustand era legacy y se eliminó en `src/core/store.js`.
const CartContext = createContext(null);

export function CartProvider({ children }) {
    const [cart, setCart] = useState([]);
    const cartRef = useRef(cart);
    useEffect(() => { cartRef.current = cart; }, [cart]);

    // Navegacion destino tras cargar carrito reciclado
    const [pendingNavigate, setPendingNavigate] = useState(null);

    // Estado del descuento global
    const [discount, setDiscount] = useState({ type: 'percentage', value: 0 });

    /**
     * Carga un carrito reciclado desde cualquier parte de la app.
     * @param {Array} items - Array de items de la venta original
     * @param {string} navigateTo - Tab destino (e.g. 'ventas')
     */
    const loadCart = useCallback((items, navigateTo = 'ventas') => {
        if (!Array.isArray(items) || items.length === 0) {
            showToast('No hay productos para reciclar en este registro.', 'warning');
            return;
        }

        // Filtrar productos válidos (precio > 0, no negativos, no gastos)
        const validItems = items.filter(item =>
            item &&
            typeof item === 'object' &&
            (Number(item.priceUsd) > 0 || Number(item.priceBs) > 0) &&
            !String(item.name || '').toLowerCase().startsWith('gasto:')
        );

        if (validItems.length === 0) {
            showToast('Este registro no contiene productos válidos para reciclar.', 'warning');
            return;
        }

        setCart(validItems.map((item, idx) => ({
            id: item.id || item.productId || item._originalId || `cart_item_${Date.now()}_${idx}`,
            name: item.name || 'Producto',
            qty: Math.max(0.001, Number(item.qty) || 1),
            priceUsd: Math.max(0, Number(item.priceUsd) || 0),
            costBs: item.costBs || 0,
            costUsd: item.costUsd || 0,
            isWeight: Boolean(item.isWeight),
            forceBcv: Boolean(item.forceBcv),
            _mode: item._mode || item.mode || 'unit',
            boxUnits: item.boxUnits || null,
            halfBoxUnits: item.halfBoxUnits || null,
        })));
        setPendingNavigate(navigateTo);
    }, []);

    const clearCart = useCallback(() => {
        setCart([]);
        setDiscount({ type: 'percentage', value: 0 });
    }, []);

    // HOOK-005: Memoizar el value para que los consumidores no se re-rendericen
    // en cada render del provider a menos que el carrito o el descuento cambien.
    // setCart/setPendingNavigate/setDiscount son estables (de useState).
    const value = useMemo(() => ({
        cart, setCart, cartRef, loadCart, clearCart,
        pendingNavigate, setPendingNavigate,
        discount, setDiscount
    }), [cart, pendingNavigate, discount, loadCart, clearCart]);

    return (
        <CartContext.Provider value={value}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error('useCart must be used within a CartProvider');
    return ctx;
}
