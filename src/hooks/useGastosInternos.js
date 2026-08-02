import { useState, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { subR, sumR } from '../utils/dinero';
import { showToast } from '../components/Toast';

const SALES_KEY    = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

export const GASTO_CATEGORIES = [
    { id: 'insumos',      label: 'Insumos',          icon: '📦' },
    { id: 'servicios',    label: 'Servicios',         icon: '💡' },
    { id: 'transporte',   label: 'Transporte',        icon: '🚗' },
    { id: 'personal',     label: 'Personal',          icon: '👤' },
    { id: 'mantenimiento',label: 'Mantenimiento',     icon: '🔧' },
    { id: 'autoconsumo',  label: 'Autoconsumo',       icon: '🏠' },
    { id: 'otros',        label: 'Otros',             icon: '📝' },
];

export function useGastosInternos({ bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog, sales = [], setSales }) {
    const [isAddGastoOpen, setIsAddGastoOpen] = useState(false);

    // ─── Gasto de caja normal (sin movimiento de inventario) ────────────────
    const registrarGasto = useCallback(async ({ description, category, amountUsd, amountBs, methodId, currency, note }) => {
        triggerHaptic && triggerHaptic();

        if (!description.trim() || (!amountUsd && !amountBs)) {
            showToast('Descripción y monto requeridos', 'warning');
            return false;
        }

        const totalEnBs  = currency === 'BS'  ? amountBs  : (amountUsd * bcvRate);
        const totalEnUsd = currency === 'USD' ? amountUsd : (bcvRate > 0 ? amountBs / bcvRate : 0);
        const totalEnCop = currency === 'COP' ? amountBs  : (amountUsd * (tasaCop || 0));

        const newGasto = {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            tipo: 'GASTO_INTERNO',
            cajaCerrada: false,
            afectaCaja: true,
            description: description.trim(),
            category: category,
            note: note?.trim() || '',
            totalBs:  -totalEnBs,
            totalUsd: -totalEnUsd,
            ...(copEnabled && { totalCop: -totalEnCop }),
            paymentMethod: methodId,
            payments: [{
                methodId:  methodId,
                amountUsd: currency === 'USD' ? -totalEnUsd : 0,
                amountBs:  currency === 'BS'  ? -totalEnBs  : 0,
                ...(copEnabled && { amountCop: currency === 'COP' ? -totalEnCop : 0 }),
                currency:    currency,
                methodLabel: 'Gasto Interno'
            }],
            items: [{
                name:     `Gasto: ${description.trim()}`,
                qty:      1,
                priceUsd: -totalEnUsd,
                costBs:   0
            }]
        };

        const updatedSales = await withLock('pos_write_lock', async () => {
            const freshSales = await storageService.getItem(SALES_KEY, []) || [];
            const freshUpdated = [newGasto, ...freshSales];
            await storageService.setItem(SALES_KEY, freshUpdated);
            return freshUpdated;
        });

        if (typeof setSales === 'function') setSales(updatedSales);

        showToast('Gasto registrado con éxito', 'success');
        if (typeof auditLog === 'function') {
            auditLog('CAJA', 'REGISTRO_GASTO', `Gasto registrado: "${description}" - $${totalEnUsd.toFixed(2)}`);
        }
        setIsAddGastoOpen(false);
        return true;
    }, [setSales, bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog]);

    // ─── Autoconsumo: retiro de mercancía por el dueño ──────────────────────
    const registrarAutoconsumo = useCallback(async ({ description, items, valoracion = 'costo', note, totalUsd, totalBs }) => {
        triggerHaptic && triggerHaptic();

        if (!items || items.length === 0) {
            showToast('Selecciona al menos un producto', 'warning');
            return false;
        }

        const result = await withLock('pos_write_lock', async () => {
            // 1. Leer productos frescos de IndexedDB
            const freshProducts = await storageService.getItem(PRODUCTS_KEY, []);
            const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';

            // 2. Deducir stock
            const updatedProducts = freshProducts.map(p => {
                const cartItem = items.find(i => i.id === p.id);
                if (!cartItem) return p;
                const newStock = subR(p.stock ?? 0, cartItem.qty);
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
            });

            await storageService.setItem(PRODUCTS_KEY, updatedProducts);

            // 3. Crear registro de gasto
            const gasto = {
                id:           crypto.randomUUID(),
                timestamp:    new Date().toISOString(),
                tipo:         'GASTO_INTERNO',
                category:     'autoconsumo',
                isAutoconsumo: true,
                afectaCaja:   false,       // NO afecta el cuadre de caja física
                cajaCerrada:  false,
                valoracion,
                description:  description.trim(),
                note:         note?.trim() || '',
                totalUsd:     -Math.abs(totalUsd),
                totalBs:      -Math.abs(totalBs),
                ...(copEnabled && { totalCop: -(Math.abs(totalUsd) * (tasaCop || 0)) }),
                paymentMethod: 'autoconsumo',
                payments: [{
                    methodId:    'autoconsumo',
                    amountUsd:   -Math.abs(totalUsd),
                    amountBs:    -Math.abs(totalBs),
                    currency:    'USD',
                    methodLabel: 'Autoconsumo de Inventario'
                }],
                items: items.map(i => ({
                    id:       i.id,
                    name:     i.name,
                    qty:      i.qty,
                    costUsd:  i.costUsd  || 0,
                    priceUsd: i.priceUsd || 0,
                })),
            };

            // 4. Guardar en sales
            const freshSales = await storageService.getItem(SALES_KEY, []);
            const updatedSales = [gasto, ...freshSales];
            await storageService.setItem(SALES_KEY, updatedSales);

            // 5. Registro inmutable en Kardex
            // F1: ya estamos DENTRO de withLock('pos_write_lock'); usar la variante sin
            // cerrojo. La fachada `recordKardexMovement` volvería a pedir el mismo cerrojo
            // y, al no existir ya el guard de reentrancia, produciría un auto-deadlock.
            try {
                const { recordKardexMovementUnlocked } = await import('../services/kardexService');
                const user = useAuthStore.getState().usuarioActivo;
                for (const item of items) {
                    const prod = freshProducts.find(p => p.id === item.id);
                    const stockBefore = Number(prod?.stock) || 0;
                    const stockAfter = Math.max(0, stockBefore - item.qty);
                    await recordKardexMovementUnlocked({
                        productoId: item.id,
                        productoNombre: item.name,
                        sku: prod?.barcode || prod?.sku || '',
                        tipo: 'SALIDA',
                        subtipo: 'AUTOCONSUMO',
                        cantidad: -Math.abs(item.qty),
                        unidad: prod?.unit || 'unidad',
                        stock_antes: stockBefore,
                        stock_despues: stockAfter,
                        costoUnitario: Number(item.costUsd || prod?.costUsd || 0),
                        referenciaId: gasto.id,
                        referenciaTipo: 'GASTO_INTERNO',
                        referenciaNumero: 'AUTOCONSUMO',
                        motivo: description.trim() || 'Retiro por autoconsumo / merma',
                        usuarioId: user?.id || null,
                        usuarioNombre: user?.nombre || 'Administrador'
                    });
                }
            } catch (kardexErr) { console.error('[useGastosInternos] Error registrando Kardex:', kardexErr); }

            return { gasto, updatedSales };
        });

        if (result) {
            if (typeof setSales === 'function') setSales(result.updatedSales);
            showToast('Retiro de inventario registrado', 'success');
            if (typeof auditLog === 'function') {
                auditLog('CAJA', 'AUTOCONSUMO', `Retiro de ${items.length} producto(s) - $${Math.abs(totalUsd).toFixed(2)}`);
            }
            setIsAddGastoOpen(false);
            return true;
        }

        showToast('Error al registrar el retiro', 'error');
        return false;
    }, [sales, setSales, bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog]);

    // ─── Anulación (con reversión de stock si es autoconsumo) ───────────────
    const anularGasto = useCallback(async (gastoId) => {
        triggerHaptic && triggerHaptic();

        const targetGasto = sales.find(s => s.id === gastoId);
        if (!targetGasto) return;

        // Si es autoconsumo, devolver el stock y registrar en Kardex
        if (targetGasto.isAutoconsumo && Array.isArray(targetGasto.items)) {
            await withLock('pos_write_lock', async () => {
                const freshProducts = await storageService.getItem(PRODUCTS_KEY, []);
                const restored = freshProducts.map(p => {
                    const item = targetGasto.items.find(i => i.id === p.id);
                    if (!item) return p;
                    return { ...p, stock: sumR(p.stock ?? 0, item.qty) };
                });
                await storageService.setItem(PRODUCTS_KEY, restored);

                // F1: dentro de withLock('pos_write_lock') → variante sin cerrojo.
                try {
                    const { recordKardexMovementUnlocked } = await import('../services/kardexService');
                    const user = useAuthStore.getState().usuarioActivo;
                    for (const item of targetGasto.items) {
                        const prod = freshProducts.find(p => p.id === item.id);
                        const stockBefore = Number(prod?.stock) || 0;
                        const stockAfter = stockBefore + item.qty;
                        await recordKardexMovementUnlocked({
                            productoId: item.id,
                            productoNombre: item.name,
                            sku: prod?.barcode || prod?.sku || '',
                            tipo: 'ENTRADA',
                            subtipo: 'DEVOLUCION_AUTOCONSUMO',
                            cantidad: Math.abs(item.qty),
                            unidad: prod?.unit || 'unidad',
                            stock_antes: stockBefore,
                            stock_despues: stockAfter,
                            costoUnitario: Number(item.costUsd || prod?.costUsd || 0),
                            referenciaId: targetGasto.id,
                            referenciaTipo: 'ANULACION_GASTO',
                            referenciaNumero: 'REVERSION',
                            motivo: 'Restauración de stock por anulación de autoconsumo/merma',
                            usuarioId: user?.id || null,
                            usuarioNombre: user?.nombre || 'Administrador'
                        });
                    }
                } catch (e) { console.error('[useGastosInternos] Error registrando Kardex anulación:', e); }
            });
        }

        const updatedSales = sales.map(s => {
            if (s.id === gastoId) {
                return { ...s, status: 'ANULADA', voidedAt: new Date().toISOString() };
            }
            return s;
        });

        await storageService.setItem(SALES_KEY, updatedSales);
        if (typeof setSales === 'function') setSales(updatedSales);

        const label = targetGasto.isAutoconsumo ? 'Autoconsumo anulado y stock devuelto' : 'Gasto anulado con éxito';
        showToast(label, 'success');
        if (typeof auditLog === 'function') {
            auditLog('CAJA', 'ANULAR_GASTO', `Gasto anulado: "${targetGasto.description}"`);
        }
    }, [sales, setSales, triggerHaptic, auditLog]);

    return {
        isAddGastoOpen,
        setIsAddGastoOpen,
        registrarGasto,
        registrarAutoconsumo,
        anularGasto,
        categories: GASTO_CATEGORIES
    };
}
