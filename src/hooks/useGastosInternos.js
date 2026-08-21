import { useState, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { showToast } from '../components/Toast';
import { useAuthStore } from './store/useAuthStore';
import { logEvent } from '../services/auditService';
import { applyInventoryOperationUnlocked } from '../services/inventoryOperationService';

const SALES_KEY = 'bodega_sales_v1';
let isGastoProcessing = false;

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
        if (isGastoProcessing) return false;
        triggerHaptic && triggerHaptic();

        if (!description.trim() || (!amountUsd && !amountBs)) {
            showToast('Descripción y monto requeridos', 'warning');
            return false;
        }

        isGastoProcessing = true;
        try {

        const isUsd = currency === 'USD';
        const isBs  = currency === 'BS';
        const isCop = currency === 'COP';

        const totalEnBs  = isBs  ? (amountBs || 0) : 0;
        const totalEnUsd = isUsd ? (amountUsd || 0) : 0;
        const totalEnCop = isCop ? (amountBs || amountUsd || 0) : 0;
        const gastoTimestamp = new Date().toISOString();
        const gastoActor = useAuthStore.getState().usuarioActivo;
        const actorName = gastoActor?.nombre || gastoActor?.usuario || 'Sistema';
        const actorRole = gastoActor?.rol || 'SYSTEM';
        const deviceId = localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL';

        const newGasto = {
            id: crypto.randomUUID(),
            timestamp: gastoTimestamp,
            createdAt: gastoTimestamp,
            updatedAt: gastoTimestamp,
            usuarioId: gastoActor?.id || null,
            usuarioNombre: actorName,
            usuarioRol: actorRole,
            actor: { id: gastoActor?.id || null, nombre: actorName, rol: actorRole },
            deviceId,
            tipo: 'GASTO_INTERNO',
            cajaCerrada: false,
            afectaCaja: true,
            currency: currency,
            description: description.trim(),
            category: category,
            note: note?.trim() || '',
            totalBs:  -totalEnBs,
            totalUsd: -totalEnUsd,
            ...(copEnabled && { totalCop: -totalEnCop }),
            paymentMethod: methodId,
            payments: [{
                methodId:  methodId,
                amountUsd: isUsd ? -totalEnUsd : 0,
                amountBs:  isBs  ? -totalEnBs  : 0,
                ...(copEnabled && { amountCop: isCop ? -totalEnCop : 0 }),
                currency:    currency,
                methodLabel: 'Gasto Interno'
            }],
            items: [{
                name:     `Gasto: ${description.trim()}`,
                qty:      1,
                priceUsd: isUsd ? -totalEnUsd : 0,
                costBs:   isBs  ? -totalEnBs  : 0
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
        const gastoDescription = `Gasto registrado: "${description}" - $${totalEnUsd.toFixed(2)}`;
        if (typeof auditLog === 'function') auditLog('CAJA', 'REGISTRO_GASTO', gastoDescription);
        else logEvent('CAJA', 'REGISTRO_GASTO', gastoDescription, gastoActor, { gastoId: newGasto.id, deviceId });
        setIsAddGastoOpen(false);
        return true;
        } finally {
            setTimeout(() => { isProcessingRef.current = false; }, 800);
        }
    }, [setSales, bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog]);

    // ─── Autoconsumo: retiro de mercancía por el dueño ──────────────────────
    const registrarAutoconsumo = useCallback(async ({ description, items, valoracion = 'venta', note, totalUsd, totalBs }) => {
        if (isGastoProcessing) return false;
        triggerHaptic && triggerHaptic();

        if (!items || items.length === 0) {
            showToast('Selecciona al menos un producto', 'warning');
            return false;
        }

        isGastoProcessing = true;
        try {
            const result = await withLock('pos_write_lock', async () => {
                // 1. Leer productos frescos de IndexedDB
                const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';

                // 2. Crear el registro de gasto y aplicar el retiro físico mediante
                // la fachada única Stock + Kardex.
                const gastoTimestamp = new Date().toISOString();
                const gastoActor = useAuthStore.getState().usuarioActivo;
                const gasto = {
                    id:           crypto.randomUUID(),
                    timestamp:    gastoTimestamp,
                    createdAt:    gastoTimestamp,
                    updatedAt:    gastoTimestamp,
                    usuarioId:    gastoActor?.id || null,
                    usuarioNombre: gastoActor?.nombre || gastoActor?.usuario || 'Sistema',
                    usuarioRol:   gastoActor?.rol || 'SYSTEM',
                    actor:        { id: gastoActor?.id || null, nombre: gastoActor?.nombre || gastoActor?.usuario || 'Sistema', rol: gastoActor?.rol || 'SYSTEM' },
                    deviceId:     localStorage.getItem('dj_device_id') || 'CAJA_PRINCIPAL',
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

                const inventoryResult = await applyInventoryOperationUnlocked({
                    operationId: `gasto_${gasto.id}`,
                    referenceId: gasto.id,
                    referenceType: 'GASTO_INTERNO',
                    source: 'AUTOCONSUMO',
                    tipo: 'AUTOCONSUMO',
                    subtipo: 'AUTOCONSUMO',
                    reason: description.trim() || 'Autoconsumo',
                    allowNegative: allowNeg,
                    actor: {
                        usuarioId: gastoActor?.id || null,
                        usuarioNombre: gastoActor?.nombre || gastoActor?.usuario || 'Administrador',
                        usuarioRol: gastoActor?.rol || 'SYSTEM',
                    },
                    deductions: items.map(item => ({
                        productoId: item.id,
                        cantidad: -Math.abs(Number(item.qty) || 0),
                        origen: 'AUTOCONSUMO'
                    })),
                    metadata: { gastoId: gasto.id, category: 'autoconsumo' }
                });
                if (!inventoryResult.success) {
                    throw new Error(inventoryResult.error || 'No se pudo retirar el inventario');
                }

                // 3. Guardar el gasto después de que el movimiento físico quedó
                // aplicado/registrado. Si este paso falla, el gasto puede reintentarse
                // con el mismo ID sin volver a descontar stock.
                const freshSales = await storageService.getItem(SALES_KEY, []);
                const updatedSales = [gasto, ...freshSales];
                await storageService.setItem(SALES_KEY, updatedSales);

                return { gasto, updatedSales, updatedProducts: inventoryResult.updatedProducts };
            });

            if (result) {
                if (typeof setSales === 'function') setSales(result.updatedSales);
                showToast('Retiro de inventario registrado', 'success');
                const autoconsumoDescription = `Retiro de ${items.length} producto(s) - $${Math.abs(totalUsd).toFixed(2)}`;
                if (typeof auditLog === 'function') auditLog('CAJA', 'AUTOCONSUMO', autoconsumoDescription);
                else logEvent('INVENTARIO', 'AUTOCONSUMO_REGISTRADO', autoconsumoDescription, result.gasto.actor, { gastoId: result.gasto.id, deviceId: result.gasto.deviceId });
                setIsAddGastoOpen(false);
                return true;
            }

            showToast('Error al registrar el retiro', 'error');
            return false;
        } finally {
            setTimeout(() => { isGastoProcessing = false; }, 800);
        }
    }, [sales, setSales, bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog]);

    // ─── Anulación (con reversión de stock si es autoconsumo) ───────────────
    const anularGasto = useCallback(async (gastoId) => {
        triggerHaptic && triggerHaptic();

        const targetGasto = sales.find(s => s.id === gastoId);
        if (!targetGasto) return;

        // Si es autoconsumo, devolver el stock mediante una operación
        // idempotente Stock + Kardex.
        const voidActor = useAuthStore.getState().usuarioActivo;
        if (targetGasto.isAutoconsumo && Array.isArray(targetGasto.items)) {
            await withLock('pos_write_lock', async () => {
                const inventoryResult = await applyInventoryOperationUnlocked({
                    operationId: `void_gasto_${targetGasto.id}`,
                    referenceId: targetGasto.id,
                    referenceType: 'ANULACION_GASTO',
                    source: 'AUTOCONSUMO',
                    tipo: 'DEVOLUCION',
                    subtipo: 'DEVOLUCION_AUTOCONSUMO',
                    reason: 'Anulación autoconsumo',
                    allowNegative: true,
                    actor: {
                        usuarioId: voidActor?.id || null,
                        usuarioNombre: voidActor?.nombre || voidActor?.usuario || 'Administrador',
                        usuarioRol: voidActor?.rol || 'SYSTEM',
                    },
                    deductions: targetGasto.items.map(item => ({
                        productoId: item.id,
                        cantidad: Math.abs(Number(item.qty) || 0),
                        origen: 'DEVOLUCION'
                    })),
                    metadata: { gastoId: targetGasto.id }
                });
                if (!inventoryResult.success) {
                    throw new Error(inventoryResult.error || 'No se pudo devolver el inventario');
                }
            });
        }

        const updatedSales = sales.map(s => {
            if (s.id === gastoId) {
                const voidedAt = new Date().toISOString();
                return {
                    ...s,
                    status: 'ANULADA',
                    updatedAt: voidedAt,
                    voidedAt,
                    voidedById: voidActor?.id || null,
                    voidedByName: voidActor?.nombre || voidActor?.usuario || 'Sistema',
                    voidedByRole: voidActor?.rol || 'SYSTEM',
                };
            }
            return s;
        });

        await storageService.setItem(SALES_KEY, updatedSales);
        if (typeof setSales === 'function') setSales(updatedSales);

        const label = targetGasto.isAutoconsumo ? 'Autoconsumo anulado y stock devuelto' : 'Gasto anulado con éxito';
        showToast(label, 'success');
        const voidDescription = `Gasto anulado: "${targetGasto.description}"`;
        if (typeof auditLog === 'function') auditLog('CAJA', 'ANULAR_GASTO', voidDescription);
        else logEvent('CAJA', 'ANULAR_GASTO', voidDescription, voidActor, { gastoId: targetGasto.id });
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
