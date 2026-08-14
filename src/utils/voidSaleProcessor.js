import { storageService } from './storageService';
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { subR, sumR, round2 } from './dinero';
import { withLock } from './withLock';          // FIN-007: feature detection + fallback.
import { expandCartToPhysicalDeductions, aggregatePhysicalDeductions } from './inventoryMovementModel';
import { applyInventoryOperationUnlocked } from '../services/inventoryOperationService';
import { deepFreeze } from './deepFreeze';      // FIN-008: deep-freeze antes de retornar.

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';
const PRODUCTS_KEY = 'bodega_products_v1';
const INVENTORY_OPERATIONS_KEY = 'bodega_inventory_operations_v1';

/**
 * Handles the logic of voiding a transaction, reverting stock, and reverting customer balances.
 *
 * FIN-001: void de COBRO_DEUDA revierte el impacto al cliente (deuda o favor).
 * FIN-007: usa withLock (no navigator.locks directo).
 * FIN-008: deep-freeza updatedProducts/updatedCustomers antes de retornar.
 * FIN-012: resta vueltoParaMonedero de favor al anular (si el sale lo registra).
 * FIN-027: re-lee bodega_products_v1 fresco dentro del lock (no usa currentProducts stale).
 * FIN-032: remueve console.log de producción (vía logEvent en su lugar).
 */
export async function processVoidSale(sale, currentSales, currentProducts, actorOverride = null) {
    if (!sale) throw new Error("Sale object is required to void.");
    if (sale.status === 'ANULADA') throw new Error("Esta venta ya fue anulada.");

    // FIN-007: withLock reemplaza navigator.locks.request directo.
    return withLock('pos_write_lock', async () => {
        // Re-read fresh sales from storage to prevent stale data
        const freshSales = await storageService.getItem(SALES_KEY, []);
        const executingUser = useAuthStore.getState().usuarioActivo;
        const requestedBy = actorOverride && (actorOverride.id || actorOverride.nombre)
            ? actorOverride
            : null;
        const freshSale = freshSales.find(s => s.id === sale.id);
        if (!freshSale || freshSale.status === 'ANULADA') throw new Error("Esta venta ya fue anulada.");

        // 1. Releer productos frescos y expandir la venta con las mismas reglas
        // físicas usadas por el checkout. Los ítems de consumo diferido se
        // revierten únicamente mediante su ficha/despachos.
        const freshProducts = await storageService.getItem(PRODUCTS_KEY, currentProducts || []);
        const expanded = expandCartToPhysicalDeductions(freshSale.items || [], freshProducts);
        // Las ventas nuevas guardan la composición física exacta usada en el
        // checkout. Preferir la operación persistida porque conserva la cantidad
        // realmente aplicada cuando hubo clamp; para ventas históricas sin ese
        // campo se mantiene el fallback compatible con el catálogo actual.
        const inventoryOperations = await storageService.getItem(INVENTORY_OPERATIONS_KEY, []) || [];
        const saleOperation = inventoryOperations.find(operation => (
            operation?.operationId === `sale_${freshSale.id}`
            && operation?.status === 'APPLIED_LOCAL'
        ));
        const saleDeductions = saleOperation
            ? (Array.isArray(saleOperation.transitions) ? saleOperation.transitions : [])
            : (Array.isArray(freshSale.inventoryDeductionsApplied)
                ? freshSale.inventoryDeductionsApplied
                : (Array.isArray(freshSale.inventoryDeductions)
                    ? freshSale.inventoryDeductions
                    : expanded.deductions));
        const restorationEntries = aggregatePhysicalDeductions(saleDeductions)
            .map(deduction => ({
                ...deduction,
                cantidad: Math.abs(Number(deduction.cantidad)),
                cantidadSolicitada: Math.abs(Number(deduction.cantidadSolicitada ?? deduction.cantidad)),
                origen: 'DEVOLUCION'
            }));

        let updatedProducts = freshProducts;
        if (restorationEntries.length > 0) {
            const activeUser = useAuthStore.getState().usuarioActivo;
            const inventoryResult = await applyInventoryOperationUnlocked({
                operationId: `void_${freshSale.id}`,
                referenceId: freshSale.id,
                referenceType: 'ANULACION',
                source: 'ANULACION_VENTA',
                tipo: 'DEVOLUCION',
                subtipo: 'ANULACION_VENTA',
                reason: `Anulación #${freshSale.saleNumber || freshSale.id.slice(0, 8)}`,
                allowNegative: true,
                actor: {
                    usuarioId: requestedBy?.id || activeUser?.id || null,
                    usuarioNombre: requestedBy?.nombre || activeUser?.nombre || activeUser?.usuario || 'Usuario',
                    usuarioRol: requestedBy?.rol || activeUser?.rol || 'SYSTEM',
                    supervisorId: requestedBy?.id || null,
                },
                deductions: restorationEntries,
                metadata: {
                    saleId: freshSale.id,
                    saleNumber: freshSale.saleNumber || null,
                    commandId: requestedBy?.commandId || null,
                    anomalies: freshSale.inventoryAnomalies || expanded.anomalies
                }
            });
            if (!inventoryResult.success) {
                throw new Error(inventoryResult.error || 'No se pudo revertir el inventario de la venta');
            }
            updatedProducts = inventoryResult.updatedProducts || freshProducts;
        }

        // 2. Marcar venta como ANULADA solo después de que la operación física
        // haya quedado aplicada o recuperable con su outbox persistida.
        const voidedAt = new Date().toISOString();
        const updatedSales = freshSales.map(s => {
            if (s.id !== freshSale.id) return s;
            return {
                ...s,
                status: 'ANULADA',
                updatedAt: voidedAt,
                voidedAt,
                voidedById: requestedBy?.id || executingUser?.id || null,
                voidedByName: requestedBy?.nombre || executingUser?.nombre || executingUser?.usuario || 'Sistema',
                voidedByRole: requestedBy?.rol || executingUser?.rol || 'SYSTEM',
                voidRequestedBy: requestedBy
                    ? { id: requestedBy.id || null, nombre: requestedBy.nombre || 'Supervisor', rol: requestedBy.rol || 'SUPERVISOR' }
                    : null,
                voidCommandId: requestedBy?.commandId || null,
            };
        });

        // 3. Revertir Deuda/Saldo a Favor del Cliente
        const savedCustomers = await storageService.getItem(CUSTOMERS_KEY, []);
        let updatedCustomers = savedCustomers;

        // FIN-001, FIN-012: Cantidades a revertir según tipo de venta.
        const fiadoAmountUsd = sale.fiadoUsd || (sale.tipo === 'VENTA_FIADA' ? sale.totalUsd : 0) || 0;
        const favorUsed = sumR((sale.payments?.filter(p => p.methodId === 'saldo_favor') || []).map(p => p.amountUsd));
        const vueltoParaMonedero = round2(sale.vueltoParaMonedero || 0);
        const hasRecordedWalletAllocation = sale.vueltoParaMonederoDebtUsd != null
            || sale.vueltoParaMonederoFavorUsd != null;
        const walletDebtAppliedUsd = round2(Number(sale.vueltoParaMonederoDebtUsd) || 0);
        const walletFavorAppliedUsd = round2(Number(sale.vueltoParaMonederoFavorUsd) || 0);

        // FIN-001: Para COBRO_DEUDA, revertir el abono. Heurística:
        // - Si el cliente tiene favor >= cobroAmount, era un abono que dejó sobra → restar de favor.
        // - Si tiene favor pero < cobroAmount, parte era favor y parte deuda.
        // - Si no tiene favor, era un abono que redujo deuda → sumar a deuda.
        const isCobroDeuda = sale.tipo === 'COBRO_DEUDA';
        const cobroAmount = isCobroDeuda ? round2(sale.totalUsd || 0) : 0;

        const shouldTouchCustomer = sale.customerId
            && (fiadoAmountUsd > 0
                || favorUsed > 0
                || vueltoParaMonedero > 0
                || walletDebtAppliedUsd > 0
                || walletFavorAppliedUsd > 0
                || cobroAmount > 0);

        if (shouldTouchCustomer) {
            updatedCustomers = savedCustomers.map(c => {
                if (c.id !== sale.customerId) return c;

                let newDeuda = round2(c.deuda || 0);
                let newFavor = round2(c.favor || 0);

                if (isCobroDeuda && cobroAmount > 0) {
                    // FIN-001: Revertir COBRO_DEUDA (abono). El abono original redujo deuda
                    // o sumó a favor; al anular, revertimos en la dirección opuesta.
                    if (newFavor >= cobroAmount) {
                        // Todo el abono estaba como favor → quitar de favor.
                        newFavor = subR(newFavor, cobroAmount);
                    } else if (newFavor > 0) {
                        // Parte favor, parte deuda.
                        const remaining = subR(cobroAmount, newFavor);
                        newFavor = 0;
                        newDeuda = sumR(newDeuda, remaining);
                    } else {
                        // Sin favor → el abono había reducido deuda, devolverla.
                        newDeuda = sumR(newDeuda, cobroAmount);
                    }
                } else {
                    // VENTA / VENTA_FIADA: revertir favor usado, fiado generado y
                    // vuelto digital. Las ventas nuevas guardan cuánto del vuelto
                    // redujo deuda y cuánto terminó como favor; así la anulación
                    // no depende del saldo posterior del cliente.
                    if (favorUsed > 0) {
                        newFavor = sumR(newFavor, favorUsed);
                    }
                    if (fiadoAmountUsd > 0) {
                        newDeuda = subR(newDeuda, fiadoAmountUsd);
                    }
                    if (hasRecordedWalletAllocation) {
                        if (walletDebtAppliedUsd > 0) {
                            newDeuda = sumR(newDeuda, walletDebtAppliedUsd);
                        }
                        if (walletFavorAppliedUsd > 0) {
                            newFavor = subR(newFavor, walletFavorAppliedUsd);
                        }
                    } else if (vueltoParaMonedero > 0) {
                        // FIN-012: compatibilidad con ventas históricas que solo
                        // guardaban el total del vuelto para monedero.
                        newFavor = subR(newFavor, vueltoParaMonedero);
                    }
                }

                // Normalización: no permitir negativos.
                if (newDeuda < 0) newDeuda = 0;
                if (newFavor < 0) newFavor = 0;

                return { ...c, deuda: newDeuda, favor: newFavor };
            });
        }

        // 4. Anular la ficha diferida después de aplicar la devolución de los
        // movimientos inmediatos. La ficha usa su propia operación idempotente
        // para devolver únicamente los despachos físicos realizados.
        const hasDeferredConsumption = (freshSale.items || []).some(item => item.isDeferredConsumption);
        if (hasDeferredConsumption) {
            const { cancelSessionBySaleIdUnlocked } = await import('../services/consumptionSessionService');
            const activeUser = useAuthStore.getState().usuarioActivo;
            const cajeroNombre = activeUser ? (activeUser.nombre || activeUser.usuario || 'Supervisor') : 'Supervisor';
            const sessionCancelled = await cancelSessionBySaleIdUnlocked(
                freshSale.id,
                cajeroNombre,
                requestedBy || executingUser
            );
            if (!sessionCancelled) {
                throw new Error(`No se pudo anular la ficha de consumo de la venta ${freshSale.id}`);
            }
            updatedProducts = await storageService.getItem(PRODUCTS_KEY, updatedProducts) || updatedProducts;
        }

        // 5. Persistir ventas/clientes. El catálogo ya fue escrito por la
        // fachada de inventario; no se vuelve a guardar desde este flujo.
        await storageService.setItem(SALES_KEY, updatedSales);
        await storageService.setItem('bodega_sales_mirror_v1', updatedSales);
        await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);

        // FIN-008: deep-freeze outputs antes de retornar (defensa contra mutaciones posteriores).
        deepFreeze(updatedProducts);
        deepFreeze(updatedCustomers);

        // FIN-032: era console.log — movido a logEvent para auditoría.
        const user = executingUser || useAuthStore.getState().usuarioActivo;
        const auditActor = requestedBy || user;
        logEvent('VENTA', 'VENTA_ANULADA',
            `Venta #${sale.saleNumber || '?'} anulada - $${round2(sale.totalUsd || 0)}`,
            auditActor,
            {
                saleId: sale.id,
                tipo: sale.tipo,
                totalUsd: sale.totalUsd,
                executedBy: user ? { id: user.id || null, nombre: user.nombre || user.usuario || 'Sistema', rol: user.rol || 'SYSTEM' } : null,
                commandId: requestedBy?.commandId || null,
            }
        );

        return { updatedSales, updatedProducts, updatedCustomers };
    });
}
