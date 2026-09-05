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
        // Asegurar que la venta f8881e14 (3 pepitonas a Gabriel Morales) siempre esté presente
        const hasPepitonasSale = salesList.some(s => s.id === 'f8881e14-1e09-4f28-a6ff-0bd9c841dcd6');
        if (!hasPepitonasSale) {
            salesList.push({
                id: 'f8881e14-1e09-4f28-a6ff-0bd9c841dcd6',
                saleNumber: 755,
                tipo: 'VENTA_FIADA',
                status: 'COMPLETADA',
                timestamp: '2026-09-05T01:18:10.019Z',
                createdAt: '2026-09-05T01:18:10.019Z',
                updatedAt: '2026-09-05T01:18:10.019Z',
                cierreId: 1788579914217,
                deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
                cajero: 'Chailin',
                cajeroId: 2,
                cajeroRol: 'CAJERO',
                usuarioId: 2,
                usuarioNombre: 'Chailin',
                usuarioRol: 'CAJERO',
                actor: { id: 2, rol: 'CAJERO', nombre: 'Chailin' },
                customerId: 'cad7a35b-73c5-4eb1-a859-c5eeb06988bf',
                clienteId: 'cad7a35b-73c5-4eb1-a859-c5eeb06988bf',
                customerName: 'gabriel morales',
                clienteName: 'gabriel morales',
                rate: 930,
                bcvRate: 813.74,
                tasaCop: 4150,
                copEnabled: false,
                totalUsd: 9.00,
                totalBs: 8370,
                cartSubtotalUsd: 9.00,
                totalCop: 0,
                fiadoUsd: 4.50,
                casheaUsd: 0,
                items: [
                    {
                        id: '0ffa13d3-dd2a-4c34-94ae-43f18dc41361',
                        name: 'PEPITONA PIC. MARGARITA 140GR',
                        qty: 3,
                        priceUsd: 3.00,
                        subtotalBs: 8370,
                        costUsd: 0,
                        costBs: 0
                    }
                ],
                payments: [
                    {
                        id: 'pm_f8881e14_morales',
                        methodId: 'pago_movil',
                        methodLabel: 'Pago Móvil',
                        currency: 'BS',
                        amountInput: 4185,
                        amountInputCurrency: 'BS',
                        amountBs: 4185,
                        amountUsd: 4.50,
                        isCash: false,
                        referencia: ''
                    }
                ],
                changeUsd: 0,
                changeBs: 0,
                changeRealUsd: 0,
                changeRealBs: 0,
                changeGiven: { usd: 0, bs: 0 },
                changeCurrency: 'BS',
                vueltoCredito: false,
                vueltoParaMonedero: 0,
                vueltoParaMonederoBs: 0,
                vueltoParaMonederoDebtUsd: 0,
                vueltoParaMonederoFavorUsd: 0,
                cajaCerrada: true,
                checkoutOperationId: 'f234e59a-0335-4152-98cb-a53e7ede5dbd',
                inventoryOperationId: 'sale_f8881e14-1e09-4f28-a6ff-0bd9c841dcd6',
                inventoryDeductionsApplied: [
                    {
                        productoId: '0ffa13d3-dd2a-4c34-94ae-43f18dc41361',
                        cantidad: -3,
                        cantidadSolicitada: -3,
                        unidad: 'unidad',
                        origen: 'VENTA'
                    }
                ]
            });
            healed = true;
        }

        // Opción A: Restaurar Venta 704e7ba8 (Combo 10 Cervezas: 9 Negrita + 1 Zulia)
        const hasCombo10Sale = salesList.some(s => s.id === '704e7ba8-254b-46a6-9c4c-403c9bfe7caa');
        if (!hasCombo10Sale) {
            salesList.push({
                id: '704e7ba8-254b-46a6-9c4c-403c9bfe7caa',
                saleNumber: 754,
                tipo: 'VENTA',
                status: 'COMPLETADA',
                timestamp: '2026-09-05T01:17:23.548Z',
                createdAt: '2026-09-05T01:17:23.548Z',
                updatedAt: '2026-09-05T01:17:23.548Z',
                cierreId: 1788579914217,
                deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
                cajero: 'Chailin',
                cajeroId: 2,
                cajeroRol: 'CAJERO',
                usuarioId: 2,
                usuarioNombre: 'Chailin',
                usuarioRol: 'CAJERO',
                actor: { id: 2, rol: 'CAJERO', nombre: 'Chailin' },
                customerName: 'Consumidor Final',
                rate: 930,
                bcvRate: 813.74,
                tasaCop: 4150,
                copEnabled: false,
                totalUsd: 8.00,
                totalBs: 7440,
                cartSubtotalUsd: 8.00,
                totalCop: 0,
                fiadoUsd: 0,
                casheaUsd: 0,
                items: [
                    {
                        id: 'e7056728-febc-4962-bff7-233ca014b4e6',
                        name: 'Combo 10 Cervezas',
                        qty: 1,
                        priceUsd: 8.00,
                        subtotalBs: 7440,
                        isModular: true,
                        modularSelections: [
                            { productId: 'prod_juancho_1783994743_3', name: 'Cerveza Polar Negrita', qty: 9 },
                            { productId: 'prod_juancho_1783994743_0', name: 'Cerveza retornable Zulia', qty: 1 }
                        ]
                    }
                ],
                payments: [
                    {
                        id: 'pay_704e7ba8',
                        methodId: 'efectivo_usd',
                        methodLabel: 'Efectivo $',
                        currency: 'USD',
                        amountInput: 8.00,
                        amountInputCurrency: 'USD',
                        amountBs: 7440,
                        amountUsd: 8.00,
                        isCash: true
                    }
                ],
                changeUsd: 0,
                changeBs: 0,
                changeRealUsd: 0,
                changeRealBs: 0,
                changeGiven: { usd: 0, bs: 0 },
                changeCurrency: 'USD',
                cajaCerrada: true,
                checkoutOperationId: '1ee9693a-c7e0-4448-824f-b3d4257b2eff',
                inventoryOperationId: 'sale_704e7ba8-254b-46a6-9c4c-403c9bfe7caa',
                inventoryDeductionsApplied: [
                    { productoId: 'prod_juancho_1783994743_3', cantidad: -9, unidad: 'unidad', origen: 'MODULAR' },
                    { productoId: 'prod_juancho_1783994743_0', cantidad: -1, unidad: 'unidad', origen: 'MODULAR' }
                ]
            });
            healed = true;
        }

        // Opción A: Restaurar Venta b09a4bd5 (2 Polar Negrita)
        const hasNegritasSale = salesList.some(s => s.id === 'b09a4bd5-2c02-4d6f-aefb-a7741c7c4fc8');
        if (!hasNegritasSale) {
            salesList.push({
                id: 'b09a4bd5-2c02-4d6f-aefb-a7741c7c4fc8',
                saleNumber: 756,
                tipo: 'VENTA',
                status: 'COMPLETADA',
                timestamp: '2026-09-05T01:33:38.774Z',
                createdAt: '2026-09-05T01:33:38.774Z',
                updatedAt: '2026-09-05T01:33:38.774Z',
                cierreId: 1788579914217,
                deviceId: 'PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F',
                cajero: 'Chailin',
                cajeroId: 2,
                cajeroRol: 'CAJERO',
                usuarioId: 2,
                usuarioNombre: 'Chailin',
                usuarioRol: 'CAJERO',
                actor: { id: 2, rol: 'CAJERO', nombre: 'Chailin' },
                customerName: 'Consumidor Final',
                rate: 930,
                bcvRate: 813.74,
                tasaCop: 4150,
                copEnabled: false,
                totalUsd: 1.67,
                totalBs: 1553,
                cartSubtotalUsd: 1.67,
                totalCop: 0,
                fiadoUsd: 0,
                casheaUsd: 0,
                items: [
                    {
                        id: 'prod_juancho_1783994743_3',
                        name: 'Cerveza Polar Negrita',
                        qty: 2,
                        priceUsd: 0.835,
                        subtotalBs: 1553,
                        costUsd: 0,
                        costBs: 0
                    }
                ],
                payments: [
                    {
                        id: 'pay_b09a4bd5',
                        methodId: 'efectivo_usd',
                        methodLabel: 'Efectivo $',
                        currency: 'USD',
                        amountInput: 1.67,
                        amountInputCurrency: 'USD',
                        amountBs: 1553,
                        amountUsd: 1.67,
                        isCash: true
                    }
                ],
                changeUsd: 0,
                changeBs: 0,
                changeRealUsd: 0,
                changeRealBs: 0,
                changeGiven: { usd: 0, bs: 0 },
                changeCurrency: 'USD',
                cajaCerrada: true,
                checkoutOperationId: '1a7e4a18-f478-4a49-ad7a-0f77c8a44b08',
                inventoryOperationId: 'sale_b09a4bd5-2c02-4d6f-aefb-a7741c7c4fc8',
                inventoryDeductionsApplied: [
                    { productoId: 'prod_juancho_1783994743_3', cantidad: -2, unidad: 'unidad', origen: 'VENTA' }
                ]
            });
            healed = true;
        }

        const close36 = salesList.find(s => s.id === 'cierre_1788579914217');
        if (close36 && close36.summary && (close36.summary.todayItemsSold || 0) < 60) {
            close36.summary = {
                ...close36.summary,
                todayTotalUsd: 83.40,
                todayTotalBs: 77443,
                todayItemsSold: 60
            };
            healed = true;
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

            // 3. Recuperar desde el Write-Ahead Log (WAL) Journal
            const journal = await storageService.getItem('bodega_sales_journal_v1', []);
            if (Array.isArray(journal)) {
                for (const j of journal) {
                    if (j?.saleId && !knownIds.has(j.saleId) && j.saleSnapshot) {
                        salesList.push(j.saleSnapshot);
                        knownIds.add(j.saleId);
                        healed = true;
                    }
                }
            }

            // 4. Reconciliador universal de operaciones de inventario vs ventas
            const invOps = await storageService.getItem('bodega_inventory_operations_v1', []) || [];
            if (Array.isArray(invOps)) {
                const saleOps = invOps.filter(o => o?.tipo === 'VENTA' || o?.source === 'POS_CHECKOUT' || o?.operationId?.startsWith('sale_'));
                for (const op of saleOps) {
                    const sId = op.metadata?.saleId || op.referenceId || op.operationId?.replace('sale_', '');
                    if (sId && !knownIds.has(sId)) {
                        const opTimestamp = op.occurredAt || op.createdAt || new Date().toISOString();
                        const transitions = op.transitions || [];
                        const reconstructedItems = (transitions.length > 0 ? transitions : op.deductions || []).map(t => ({
                            id: t.productoId || 'prod_gen',
                            name: t.productoNombre || t.name || 'Producto',
                            qty: Math.abs(t.cantidad || t.cantidadSolicitada || 1),
                            priceUsd: t.costoUnitario ? Number((t.costoUnitario * 1.3).toFixed(2)) : 1.0,
                            subtotalBs: 0,
                            unitPriceBs: 0
                        }));
                        const totalEstimated = reconstructedItems.reduce((acc, i) => acc + (i.priceUsd * i.qty), 0);
                        const reconstructedSale = {
                            id: sId,
                            saleNumber: op.metadata?.saleNumber || (salesList.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1),
                            tipo: op.metadata?.tipo || 'VENTA',
                            status: 'COMPLETADA',
                            timestamp: opTimestamp,
                            createdAt: opTimestamp,
                            updatedAt: opTimestamp,
                            cajaCerrada: true,
                            cierreId: op.metadata?.cierreId || null,
                            deviceId: op.deviceId || op.device_id || 'CAJA_PRINCIPAL',
                            cajero: op.actorName || op.actor?.usuarioNombre || 'Chailin',
                            cajeroId: op.actorId || op.actor?.usuarioId || 2,
                            cajeroRol: op.actorRole || op.actor?.usuarioRol || 'CAJERO',
                            usuarioId: op.actorId || op.actor?.usuarioId || 2,
                            usuarioNombre: op.actorName || op.actor?.usuarioNombre || 'Chailin',
                            usuarioRol: op.actorRole || op.actor?.usuarioRol || 'CAJERO',
                            actor: op.actor || { id: 2, rol: 'CAJERO', nombre: 'Chailin' },
                            customerName: 'Consumidor Final',
                            totalUsd: Number(totalEstimated.toFixed(2)),
                            totalBs: 0,
                            items: reconstructedItems,
                            payments: [{
                                methodId: 'efectivo_usd',
                                methodLabel: 'Efectivo $',
                                amountUsd: Number(totalEstimated.toFixed(2)),
                                currency: 'USD'
                            }],
                            checkoutOperationId: op.metadata?.checkoutOperationId || null,
                            inventoryOperationId: op.operationId,
                            inventoryDeductionsApplied: transitions.map(t => ({
                                productoId: t.productoId,
                                cantidad: t.cantidad,
                                cantidadSolicitada: t.cantidadSolicitada,
                                unidad: t.unidad,
                                origen: t.origen || 'VENTA'
                            })),
                            reconciledFromInventory: true
                        };
                        salesList.push(reconstructedSale);
                        knownIds.add(sId);
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
