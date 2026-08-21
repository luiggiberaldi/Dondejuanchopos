import { describe, expect, it, beforeEach, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
    store: new Map(),
    inventoryOperations: [],
    inventoryCalls: [],
    failInventory: false,
    actor: { id: 1, nombre: 'Admin', rol: 'ADMIN' },
    requireLogin: true,
}));

function clone(value) {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
}

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => (
            ctx.store.has(key) ? clone(ctx.store.get(key)) : clone(defaultValue)
        )),
        setItem: vi.fn(async (key, value) => {
            ctx.store.set(key, clone(value));
        }),
    },
}));

vi.mock('../src/services/inventoryOperationService', () => ({
    applyInventoryOperationUnlocked: vi.fn(async operation => {
        ctx.inventoryCalls.push(clone(operation));
        if (ctx.failInventory) {
            return { success: false, pending: true, error: 'Inventario temporalmente no disponible' };
        }
        const products = clone(ctx.store.get('bodega_products_v1') || []);
        const transitions = [];
        for (const deduction of operation.deductions || []) {
            const product = products.find(item => item.id === deduction.productoId);
            if (!product) return { success: false, error: 'Producto no encontrado' };
            const before = Number(product.stock) || 0;
            const after = before + Number(deduction.cantidad || 0);
            if (!operation.allowNegative && after < 0) {
                return { success: false, error: 'Stock insuficiente' };
            }
            product.stock = after;
            transitions.push({ productoId: product.id, stockAntes: before, stockDespues: after, cantidad: deduction.cantidad });
        }
        ctx.store.set('bodega_products_v1', products);
        ctx.inventoryOperations.push({ operationId: operation.operationId, status: 'APPLIED_LOCAL' });
        return { success: true, operationId: operation.operationId, transitions, updatedProducts: products };
    }),
    getInventoryOperations: vi.fn(async () => clone(ctx.inventoryOperations)),
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(async () => undefined),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: {
        getState: () => ({ usuarioActivo: clone(ctx.actor), requireLogin: ctx.requireLogin }),
    },
}));

vi.mock('../src/config/paymentMethods', () => ({
    getActivePaymentMethods: vi.fn(async () => [
        { id: 'efectivo_usd', label: 'Efectivo en Dólares', currency: 'USD', isCash: true, isEnabled: true },
        { id: 'efectivo_bs', label: 'Efectivo en Bolívares', currency: 'BS', isCash: true, isEnabled: true },
        { id: 'pago_movil', label: 'Pago Móvil', currency: 'BS', isCash: false, isEnabled: true },
    ]),
}));

import {
    calculatePayrollSummary,
    calculateSettlementAmounts,
    getPayrollEmployeeSnapshot,
    getPayrollPeriodForDate,
    normalizePayrollSettlement,
} from '../src/utils/employeePayrollModel';
import {
    getEmployeePayrollSummary,
    getEmployees,
    getPayrollPeriod,
    registerEmployeeConsumption,
    recoverPendingEmployeeOperations,
    saveEmployee,
    saveEmployeeFromSupervisor,
    settleEmployeePayroll,
    voidEmployeeConsumption,
    voidEmployeePayrollSettlement,
} from '../src/services/employeeService';

beforeEach(() => {
    ctx.store.clear();
    ctx.inventoryOperations.length = 0;
    ctx.inventoryCalls.length = 0;
    ctx.failInventory = false;
    ctx.actor = { id: 1, nombre: 'Admin', rol: 'ADMIN' };
    ctx.requireLogin = true;
    localStorage.clear();
});

describe('employeePayrollModel', () => {
    it('calcula períodos lunes-domingo en America/Caracas como intervalo semiabierto', () => {
        const period = getPayrollPeriodForDate('2026-08-19T12:00:00.000Z');
        expect(period.id).toBe('2026-08-17');
        expect(period.periodoInicio).toBe('2026-08-17T04:00:00.000Z');
        expect(period.periodoFin).toBe('2026-08-24T04:00:00.000Z');
        expect(getPayrollPeriodForDate(period.periodoFin).id).toBe('2026-08-24');
    });

    it('usa salario y límite congelados del período', () => {
        const employee = { id: 'e1', nombre: 'Ana', salarioSemanalUsd: 200, limiteConsumoPorc: 50 };
        const period = {
            id: '2026-08-17',
            employeeSnapshots: {
                e1: { salarioSemanalUsd: 120, limiteConsumoPorc: 25, employeeNombre: 'Ana histórica' },
            },
        };
        const snapshot = getPayrollEmployeeSnapshot(employee, period);
        const summary = calculatePayrollSummary(employee, period, [{
            id: 'c1', employeeId: 'e1', periodoId: period.id, status: 'APPLIED', totalUsd: 20,
        }]);
        expect(snapshot.salarioSemanalUsd).toBe(120);
        expect(summary.salarioSemanalUsd).toBe(120);
        expect(summary.limiteConsumoUsd).toBe(30);
        expect(summary.employeeNombre).toBe('Ana histórica');
    });

    it('normaliza liquidaciones y pagos sin perder el estado de anulación', () => {
        const settlement = normalizePayrollSettlement({
            id: 's1',
            employeeId: 'e1',
            periodoId: '2026-08-17',
            netoAPagarUsd: 44.5,
            status: 'VOIDED',
            payments: [{ methodId: 'efectivo_usd', currency: 'usd', amountUsd: 44.5, isCash: true }],
        });
        expect(settlement).toMatchObject({ id: 's1', employeeId: 'e1', netoAPagarUsd: 44.5, status: 'VOIDED' });
        expect(settlement.payments[0]).toMatchObject({ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 44.5, isCash: true });
    });

    it('excluye consumos ya liquidados del siguiente saldo pendiente', () => {
        const employee = { id: 'e1', salarioSemanalUsd: 60, limiteConsumoPorc: 100 };
        const period = { id: '2026-08-17' };
        const consumption = { id: 'c1', employeeId: 'e1', periodoId: period.id, status: 'APPLIED', totalUsd: 15, settlementId: 's1' };
        expect(calculatePayrollSummary(employee, period, [consumption]).totalConsumosUsd).toBe(0);
        expect(calculatePayrollSummary(employee, period, [consumption], { includeSettled: true }).totalConsumosUsd).toBe(15);
        expect(calculateSettlementAmounts(employee, [consumption], 700, period).netoAPagarUsd).toBe(45);
    });
});

describe('employeeService', () => {
    async function createEmployee(overrides = {}) {
        return saveEmployee({
            id: overrides.id || 'e1',
            nombre: overrides.nombre || 'Ana',
            cargo: 'Cajera',
            salarioSemanalUsd: overrides.salarioSemanalUsd ?? 100,
            limiteConsumoPorc: overrides.limiteConsumoPorc ?? 50,
        });
    }

    async function seedProduct(stock = 10) {
        ctx.store.set('bodega_products_v1', [{
            id: 'p1', name: 'Harina', barcode: '123', unit: 'unidad',
            priceUsd: 5, costUsd: 3, stock,
        }]);
    }

    it('registra consumo con snapshots, Kardex delegado y sin crear venta', async () => {
        await createEmployee({ salarioSemanalUsd: 100, limiteConsumoPorc: 100 });
        await seedProduct(10);
        const result = await registerEmployeeConsumption({
            employeeId: 'e1',
            timestamp: '2026-08-19T12:00:00.000Z',
            items: [{ productId: 'p1', qty: 2 }],
            tasaBsPorUsd: 700,
            idempotencyKey: 'consume-1',
        });

        expect(result.success).toBe(true);
        expect(result.consumption.status).toBe('APPLIED');
        expect(result.consumption.totalUsd).toBe(10);
        expect(result.consumption.items[0]).toMatchObject({ priceUsd: 5, costUsd: 3, qty: 2 });
        expect(ctx.store.get('bodega_products_v1')[0].stock).toBe(8);
        expect(ctx.store.get('bodega_sales_v1') || []).toEqual([]);
        expect(ctx.inventoryCalls[0]).toMatchObject({
            referenceType: 'CONSUMO_EMPLEADO',
            source: 'CONSUMO_EMPLEADO',
            allowNegative: false,
        });
        expect(ctx.store.get('bodega_employee_payroll_projection_v1').employees[0].totalConsumosUsd).toBe(10);
    });

    it('rechaza stock insuficiente antes de persistir el consumo', async () => {
        await createEmployee();
        await seedProduct(1);
        await expect(registerEmployeeConsumption({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 2 }], idempotencyKey: 'too-much',
        })).rejects.toThrow(/Stock insuficiente/);
        expect(ctx.store.get('bodega_employee_consumptions_v1') || []).toEqual([]);
        expect(ctx.inventoryCalls).toHaveLength(0);
    });

    it('aplica límite, excepción ADMIN e idempotencia de doble envío', async () => {
        await createEmployee({ salarioSemanalUsd: 10, limiteConsumoPorc: 50 });
        await seedProduct(10);
        await expect(registerEmployeeConsumption({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 2 }], idempotencyKey: 'limit-1',
        })).rejects.toThrow(/límite semanal/);

        const first = await registerEmployeeConsumption({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 2 }], overrideLimit: true, idempotencyKey: 'limit-1',
        });
        const second = await registerEmployeeConsumption({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 2 }], overrideLimit: true, idempotencyKey: 'limit-1',
        });
        expect(first.success).toBe(true);
        expect(second.idempotent).toBe(true);
        expect(ctx.inventoryCalls).toHaveLength(1);
        expect(ctx.store.get('bodega_products_v1')[0].stock).toBe(8);
    });

    it('congela salario del período aunque el catálogo se edite después', async () => {
        await createEmployee({ salarioSemanalUsd: 100, limiteConsumoPorc: 100 });
        const firstPeriod = await getPayrollPeriod();
        await saveEmployee({ id: 'e1', nombre: 'Ana', cargo: 'Supervisora', salarioSemanalUsd: 200, limiteConsumoPorc: 100 });
        const summary = await getEmployeePayrollSummary('e1', firstPeriod.id);
        expect(summary.salarioSemanalUsd).toBe(100);
        expect((await getEmployees())[0].salarioSemanalUsd).toBe(200);
        expect((await getPayrollPeriod(firstPeriod.id)).employeeSnapshots.e1.salarioSemanalUsd).toBe(100);
    });

    it('recupera un consumo pendiente sin duplicar la operación física', async () => {
        await createEmployee({ salarioSemanalUsd: 100, limiteConsumoPorc: 100 });
        await seedProduct(10);
        ctx.failInventory = true;
        const failed = await registerEmployeeConsumption({
            employeeId: 'e1', items: [{ productId: 'p1', qty: 1 }], idempotencyKey: 'recover-1',
        });
        expect(failed.success).toBe(false);
        expect(ctx.store.get('bodega_employee_consumptions_v1')[0].status).toBe('FAILED_RETRYABLE');

        ctx.failInventory = false;
        const recovered = await recoverPendingEmployeeOperations();
        expect(recovered.some(item => item.consumptionId === failed.consumption.id && item.success)).toBe(true);
        expect(ctx.store.get('bodega_employee_consumptions_v1')[0].status).toBe('APPLIED');
        expect(ctx.store.get('bodega_products_v1')[0].stock).toBe(9);
    });

    it('anula un consumo, devuelve inventario y conserva el historial', async () => {
        await createEmployee({ salarioSemanalUsd: 100, limiteConsumoPorc: 100 });
        await seedProduct(5);
        const registered = await registerEmployeeConsumption({
            employeeId: 'e1',
            items: [{ productId: 'p1', qty: 2 }],
            idempotencyKey: 'void-1',
        });

        const result = await voidEmployeeConsumption(registered.consumption.id, 'Producto devuelto');
        expect(result.success).toBe(true);
        expect(result.consumption).toMatchObject({ status: 'VOIDED', voidReason: 'Producto devuelto' });
        expect(ctx.store.get('bodega_products_v1')[0].stock).toBe(5);
        expect(ctx.store.get('bodega_employee_consumptions_v1')[0].status).toBe('VOIDED');
        expect(ctx.store.get('bodega_sales_v1') || []).toEqual([]);
    });

    it('bloquea a CAJERO de configurar empleados y liquidar nómina', async () => {
        ctx.actor = { id: 2, nombre: 'Cajero', rol: 'CAJERO' };
        await expect(saveEmployee({ nombre: 'No autorizado', salarioSemanalUsd: 50, limiteConsumoPorc: 100 }))
            .rejects.toThrow(/Permiso denegado/);
        await expect(settleEmployeePayroll({ employeeId: 'e1', tasaBcv: 700 }))
            .rejects.toThrow(/Permiso denegado/);
    });

    it('permite al Supervisor remoto crear empleados aunque la sesión local sea CAJERO', async () => {
        ctx.actor = { id: 2, nombre: 'Cajero', rol: 'CAJERO' };
        const employee = await saveEmployeeFromSupervisor({
            id: 'remote-e1',
            nombre: 'Empleado remoto',
            cargo: 'Cajero',
            salarioSemanalUsd: 120,
            limiteConsumoPorc: 80,
        }, {
            id: 'mon-1',
            nombre: 'Supervisor remoto',
            rol: 'SUPERVISOR',
        });

        expect(employee).toMatchObject({ id: 'remote-e1', nombre: 'Empleado remoto' });
        expect((await getEmployees())[0]).toMatchObject({ id: 'remote-e1', nombre: 'Empleado remoto' });
    });

    it('rechaza actores no supervisor en el camino remoto', async () => {
        await expect(saveEmployeeFromSupervisor({
            id: 'remote-e2',
            nombre: 'No autorizado',
            salarioSemanalUsd: 50,
            limiteConsumoPorc: 100,
        }, { id: 2, nombre: 'Cajero', rol: 'CAJERO' }))
            .rejects.toThrow(/Permiso denegado/);
    });

    it('liquida en efectivo y deja movimiento idempotente que sí afecta caja', async () => {
        await createEmployee({ salarioSemanalUsd: 100, limiteConsumoPorc: 100 });
        await seedProduct(10);
        await registerEmployeeConsumption({ employeeId: 'e1', items: [{ productId: 'p1', qty: 1 }], idempotencyKey: 'c1' });
        ctx.store.set('bodega_sales_v1', [{ id: 'open', tipo: 'APERTURA_CAJA', openingUsd: 0, openingBs: 0, cajaCerrada: false }]);

        const result = await settleEmployeePayroll({
            employeeId: 'e1', tasaBcv: 700, metodoPago: 'efectivo_usd', currency: 'USD',
            idempotencyKey: 'settle-1',
        });
        const movement = ctx.store.get('bodega_sales_v1').find(item => item.isPayrollSettlement);
        expect(result.success).toBe(true);
        expect(result.settlement.netoAPagarUsd).toBe(95);
        expect(movement).toMatchObject({ tipo: 'GASTO_INTERNO', afectaCaja: true, totalUsd: -95 });
        expect(movement.payments[0]).toMatchObject({ amountUsd: -95, isCash: true });
        expect(ctx.store.get('bodega_employee_consumptions_v1')[0].settlementId).toBe(result.settlement.id);

        const retry = await settleEmployeePayroll({
            employeeId: 'e1', tasaBcv: 700, metodoPago: 'efectivo_usd', currency: 'USD',
            idempotencyKey: 'settle-1',
        });
        expect(retry.idempotent).toBe(true);
        expect(ctx.store.get('bodega_sales_v1').filter(item => item.isPayrollSettlement)).toHaveLength(1);
    });

    it('anula una liquidación con reversión financiera y libera sus consumos', async () => {
        await createEmployee({ salarioSemanalUsd: 100, limiteConsumoPorc: 100 });
        await seedProduct(10);
        await registerEmployeeConsumption({ employeeId: 'e1', items: [{ productId: 'p1', qty: 1 }], idempotencyKey: 'settle-void-consumption' });
        ctx.store.set('bodega_sales_v1', [{ id: 'open', tipo: 'APERTURA_CAJA', openingUsd: 0, openingBs: 0, cajaCerrada: false }]);

        const settled = await settleEmployeePayroll({
            employeeId: 'e1', tasaBcv: 700, metodoPago: 'efectivo_usd', currency: 'USD',
            idempotencyKey: 'settle-void-1',
        });
        const voided = await voidEmployeePayrollSettlement(settled.settlement.id, 'Corrección de nómina');
        expect(voided.settlement).toMatchObject({ status: 'VOIDED', voidReason: 'Corrección de nómina' });
        expect(voided.reversal).toMatchObject({
            tipo: 'GASTO_INTERNO',
            isPayrollSettlementReversal: true,
            afectaCaja: true,
            totalUsd: 95,
        });
        expect(ctx.store.get('bodega_employee_consumptions_v1')[0].settlementId).toBeNull();
        expect(ctx.store.get('bodega_sales_v1').filter(item => item.isPayrollSettlement)).toHaveLength(2);
    });

    it('recupera una liquidación pendiente recreando el movimiento espejo sin duplicarlo', async () => {
        await createEmployee({ salarioSemanalUsd: 60, limiteConsumoPorc: 100 });
        const period = await getPayrollPeriod();
        const pendingSettlement = {
            id: 'settlement-recovery-1',
            employeeId: 'e1',
            employeeNombre: 'Ana',
            periodoId: period.id,
            periodoInicio: period.periodoInicio,
            periodoFin: period.periodoFin,
            salarioSemanalUsd: 60,
            totalConsumosUsd: 0,
            netoAPagarUsd: 60,
            netoAPagarBs: 42000,
            tasaBcv: 700,
            payments: [{
                methodId: 'efectivo_usd',
                methodLabel: 'Efectivo en Dólares',
                currency: 'USD',
                amountUsd: 60,
                amountBs: 0,
                amountCop: 0,
                isCash: true,
                reference: null,
            }],
            status: 'PENDING',
            paidAt: null,
            consumptionIds: [],
            cashMovementId: 'payroll_cash_settlement-recovery-1',
            idempotencyKey: 'settlement-recovery-key',
            actor: ctx.actor,
        };
        ctx.store.set('bodega_payroll_settlements_v1', [pendingSettlement]);
        ctx.store.set('bodega_sales_v1', [{
            id: 'open',
            tipo: 'APERTURA_CAJA',
            openingUsd: 0,
            openingBs: 0,
            cajaCerrada: false,
        }]);

        const recovered = await recoverPendingEmployeeOperations();
        expect(recovered).toEqual(expect.arrayContaining([
            expect.objectContaining({ settlementId: pendingSettlement.id, success: true }),
        ]));
        expect(ctx.store.get('bodega_payroll_settlements_v1')[0]).toMatchObject({ status: 'PAID' });
        expect(ctx.store.get('bodega_sales_v1').filter(item => item.isPayrollSettlement)).toHaveLength(1);

        await recoverPendingEmployeeOperations();
        expect(ctx.store.get('bodega_sales_v1').filter(item => item.isPayrollSettlement)).toHaveLength(1);
    });

    it('liquida en pago móvil sin descontar la gaveta y sin inventar USD', async () => {
        await createEmployee({ salarioSemanalUsd: 100, limiteConsumoPorc: 100 });
        await seedProduct(10);
        ctx.store.set('bodega_sales_v1', []);
        const result = await settleEmployeePayroll({
            employeeId: 'e1', tasaBcv: 700, metodoPago: 'pago_movil', currency: 'BS',
            idempotencyKey: 'digital-1',
        });
        const movement = ctx.store.get('bodega_sales_v1').find(item => item.isPayrollSettlement);
        expect(result.success).toBe(true);
        expect(movement).toMatchObject({ afectaCaja: false, totalUsd: 0, totalBs: -70000 });
        expect(movement.payments[0]).toMatchObject({ amountUsd: 0, amountBs: -70000, isCash: false });
    });
});
