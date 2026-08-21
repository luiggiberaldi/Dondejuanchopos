import { storageService } from '../utils/storageService';
import { withLock } from '../utils/withLock';
import { applyInventoryOperationUnlocked, getInventoryOperations } from './inventoryOperationService';
import { logEvent } from './auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { findOpenApertura } from '../utils/shiftScope';
import { getActivePaymentMethods } from '../config/paymentMethods';
import { divR, mulR, round2, round3, sumR } from '../utils/dinero';
import {
    EMPLOYEE_KEYS,
    EMPLOYEE_STATUS,
    PERIOD_STATUS,
    SETTLEMENT_STATUS,
    calculatePayrollSummary,
    calculateSettlementAmounts,
    getPayrollPeriodForDate,
    getPayrollEmployeeSnapshot,
    isDateInPayrollPeriod,
    normalizeActor,
    normalizeConsumption,
    normalizeEmployee,
    normalizePayrollPeriod,
    normalizePayrollSettlement,
    validateConsumptionLimit,
} from '../utils/employeePayrollModel';

const SALES_KEY = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';
const DEVICE_FALLBACK = 'CAJA_PRINCIPAL';

function newId(prefix = '') {
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return prefix ? `${prefix}_${id}` : id;
}

function getDeviceId() {
    return typeof localStorage !== 'undefined'
        ? localStorage.getItem('dj_device_id') || DEVICE_FALLBACK
        : DEVICE_FALLBACK;
}

function getActiveActor() {
    const state = useAuthStore.getState();
    const actor = normalizeActor(state.usuarioActivo || {});
    return {
        ...actor,
        requireLogin: state.requireLogin,
    };
}

function canOperateWithoutLogin(actor) {
    return actor.requireLogin === false || actor.rol === 'SYSTEM';
}

function assertRole(allowedRoles, action) {
    const actor = getActiveActor();
    if (canOperateWithoutLogin(actor) || allowedRoles.includes(actor.rol)) return actor;
    const error = new Error(`Permiso denegado para ${action}`);
    error.code = 'EMPLOYEE_PERMISSION_DENIED';
    throw error;
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function getArray(key) {
    const value = await storageService.getItem(key, []);
    return Array.isArray(value) ? value : [];
}

async function persistAndVerify(key, value) {
    await storageService.setItem(key, value);
    const persisted = await storageService.getItem(key, null);
    if (JSON.stringify(persisted) !== JSON.stringify(value)) {
        const error = new Error(`Persistencia no verificada para ${key}`);
        error.code = 'EMPLOYEE_PERSISTENCE_MISMATCH';
        throw error;
    }
    return value;
}

function validateEmployeeInput(employee) {
    if (!employee?.nombre || String(employee.nombre).trim().length < 2) {
        throw new Error('El nombre del empleado es obligatorio');
    }
    if (!Number.isFinite(Number(employee.salarioSemanalUsd)) || Number(employee.salarioSemanalUsd) < 0) {
        throw new Error('El salario semanal debe ser un monto válido');
    }
    const limit = Number(employee.limiteConsumoPorc);
    if (!Number.isFinite(limit) || limit < 0 || limit > 100) {
        throw new Error('El límite de consumo debe estar entre 0% y 100%');
    }
}

function findEmployee(employees, employeeId) {
    return employees.find(employee => String(employee?.id) === String(employeeId)) || null;
}

function normalizeProductItem(product, rawItem) {
    const qty = round3(Number(rawItem.qty));
    if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Cantidad inválida para ${product?.name || 'producto'}`);
    }
    const priceUsd = round2(Number(product.priceUsd || product.price || 0));
    if (!Number.isFinite(priceUsd) || priceUsd < 0) {
        throw new Error(`Precio inválido para ${product?.name || 'producto'}`);
    }
    return {
        productId: String(product.id),
        sku: String(product.barcode || product.sku || ''),
        name: String(product.name || 'Producto'),
        qty,
        unit: String(product.unit || 'unidad'),
        priceUsd,
        costUsd: round2(Number(product.costUsd || product.cost || product.costPrice || 0)),
    };
}

function buildInventoryRequest(consumption, actor) {
    return {
        operationId: consumption.inventoryOperationId,
        referenceId: consumption.id,
        referenceType: 'CONSUMO_EMPLEADO',
        source: 'CONSUMO_EMPLEADO',
        tipo: 'AUTOCONSUMO',
        subtipo: 'CONSUMO_EMPLEADO',
        reason: `Consumo de empleado: ${consumption.employeeNombre}`,
        allowNegative: false,
        actor,
        deductions: consumption.items.map(item => ({
            productoId: item.productId,
            cantidad: -Math.abs(Number(item.qty)),
            unidad: item.unit,
            origen: 'CONSUMO_EMPLEADO',
            metadata: {
                employeeId: consumption.employeeId,
                periodoId: consumption.periodoId,
                consumptionId: consumption.id,
            },
        })),
        metadata: {
            employeeId: consumption.employeeId,
            employeeNombre: consumption.employeeNombre,
            periodoId: consumption.periodoId,
            consumptionId: consumption.id,
            valuation: 'venta',
        },
    };
}

function buildPayrollPayments(methodId, currency, amounts) {
    const method = String(methodId || 'efectivo_usd');
    const selectedCurrency = String(currency || (
        method === 'efectivo_bs' || method === 'pago_movil' ? 'BS' : 'USD'
    )).toUpperCase();
    const isCash = method.startsWith('efectivo_') || method === 'efectivo';
    const isBs = selectedCurrency === 'BS';
    const isCop = selectedCurrency === 'COP';
    return [{
        methodId: method,
        currency: selectedCurrency,
        amountUsd: isBs || isCop ? 0 : amounts.netoAPagarUsd,
        amountBs: isBs ? amounts.netoAPagarBs : 0,
        amountCop: isCop ? (amounts.netoAPagarCop || 0) : 0,
        isCash,
        reference: null,
    }];
}

function paymentAmount(value, fallback = 0) {
    const amount = Number(value ?? fallback);
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error('El monto de pago de nómina es inválido');
    }
    return round2(amount);
}

/** Valida métodos activos y reconstruye la clasificación de caja desde catálogo. */
async function normalizePayrollPayments(rawPayments, amounts) {
    const methods = await getActivePaymentMethods();
    const methodsById = new Map(methods.map(method => [String(method.id), method]));
    const sourcePayments = Array.isArray(rawPayments) && rawPayments.length > 0
        ? rawPayments
        : buildPayrollPayments(undefined, undefined, amounts);
    const normalized = sourcePayments.map(raw => {
        const methodId = String(raw?.methodId || raw?.metodoPago || '');
        const method = methodsById.get(methodId);
        if (!method) throw new Error(`El método de pago de nómina no está activo: ${methodId || 'desconocido'}`);
        const currency = String(raw?.currency || method.currency || 'USD').toUpperCase();
        if (method.currency && String(method.currency).toUpperCase() !== currency) {
            throw new Error(`La moneda no coincide con el método ${method.label || methodId}`);
        }

        const amountUsd = paymentAmount(
            raw?.amountUsd,
            currency === 'USD' ? raw?.amount : 0,
        );
        const amountBs = paymentAmount(
            raw?.amountBs,
            currency === 'BS' ? raw?.amount : 0,
        );
        const amountCop = paymentAmount(
            raw?.amountCop,
            currency === 'COP' ? raw?.amount : 0,
        );
        if (currency === 'COP' && amountCop > 0 && amountUsd <= 0) {
            throw new Error('La liquidación en COP requiere un equivalente USD capturado');
        }
        if (method.requiresReference === true && String(raw?.reference || '').trim().length < 3) {
            throw new Error(`El método ${method.label || methodId} requiere una referencia válida`);
        }

        return {
            methodId,
            methodLabel: method.label || methodId,
            currency,
            amountUsd,
            amountBs,
            amountCop,
            isCash: method.isCash === true,
            reference: raw?.reference ? String(raw.reference).trim() : null,
        };
    });

    const totalUsdEquivalent = sumR([
        sumR(normalized.map(payment => payment.amountUsd)),
        amounts.tasaBcv > 0
            ? sumR(normalized.map(payment => divR(payment.amountBs, amounts.tasaBcv)))
            : 0,
    ]);
    const hasCopOnly = normalized.some(payment => payment.currency === 'COP' && payment.amountCop > 0)
        && totalUsdEquivalent <= 0;
    if (hasCopOnly || Math.abs(totalUsdEquivalent - amounts.netoAPagarUsd) > 0.01) {
        throw new Error('Los pagos de nómina no coinciden con el neto calculado');
    }
    return normalized;
}

function buildPayrollCashMovement(settlement, employee, payments, actor) {
    const amountUsd = sumR(payments.map(payment => payment.amountUsd || 0));
    const amountBs = sumR(payments.map(payment => payment.amountBs || 0));
    const amountCop = sumR(payments.map(payment => payment.amountCop || 0));
    const timestamp = settlement.paidAt || new Date().toISOString();
    const affectsCash = payments.some(payment => payment.isCash === true);
    return {
        id: settlement.cashMovementId,
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        tipo: 'GASTO_INTERNO',
        category: 'nomina',
        description: `Pago de nómina: ${employee.nombre}`,
        note: settlement.nota || '',
        isPayrollSettlement: true,
        payrollSettlementId: settlement.id,
        settlementId: settlement.id,
        afectaCaja: affectsCash,
        cajaCerrada: false,
        totalUsd: -amountUsd,
        totalBs: -amountBs,
        totalCop: -amountCop,
        paymentMethod: payments.map(payment => payment.methodId).join('+') || 'efectivo_usd',
        payments: payments.map(item => ({
            ...item,
            amountUsd: -Math.abs(Number(item.amountUsd || 0)),
            amountBs: -Math.abs(Number(item.amountBs || 0)),
            amountCop: -Math.abs(Number(item.amountCop || 0)),
            methodLabel: item.methodLabel || 'Pago de Nómina',
        })),
        items: [{
            name: `Nómina: ${employee.nombre}`,
            qty: 1,
            priceUsd: -Math.abs(settlement.netoAPagarUsd),
            costBs: -Math.abs(settlement.netoAPagarBs),
        }],
        actor: clone(actor),
        usuarioId: actor.id,
        usuarioNombre: actor.nombre,
        usuarioRol: actor.rol,
        deviceId: getDeviceId(),
    };
}

function buildPayrollVoidMovement(settlement, originalMovement, actor) {
    const timestamp = new Date().toISOString();
    const originalPayments = Array.isArray(originalMovement?.payments)
        ? originalMovement.payments
        : (settlement.payments || []).map(payment => ({
            ...payment,
            amountUsd: -Math.abs(Number(payment.amountUsd || 0)),
            amountBs: -Math.abs(Number(payment.amountBs || 0)),
            amountCop: -Math.abs(Number(payment.amountCop || 0)),
        }));
    return {
        id: settlement.cashReversalMovementId || `payroll_void_${settlement.id}`,
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        tipo: 'GASTO_INTERNO',
        category: 'nomina_anulacion',
        description: `Anulación de pago de nómina: ${settlement.employeeNombre}`,
        note: settlement.voidReason || 'Anulación de liquidación de nómina',
        isPayrollSettlement: true,
        isPayrollSettlementReversal: true,
        payrollSettlementId: settlement.id,
        settlementId: settlement.id,
        originalCashMovementId: settlement.cashMovementId || null,
        afectaCaja: originalMovement?.afectaCaja === true,
        cajaCerrada: false,
        totalUsd: Math.abs(Number(originalMovement?.totalUsd ?? -settlement.netoAPagarUsd)),
        totalBs: Math.abs(Number(originalMovement?.totalBs ?? -settlement.netoAPagarBs)),
        totalCop: Math.abs(Number(originalMovement?.totalCop || 0)),
        paymentMethod: originalMovement?.paymentMethod || settlement.payments?.map(payment => payment.methodId).join('+') || 'efectivo_usd',
        payments: originalPayments.map(payment => ({
            ...payment,
            amountUsd: Math.abs(Number(payment.amountUsd || 0)),
            amountBs: Math.abs(Number(payment.amountBs || 0)),
            amountCop: Math.abs(Number(payment.amountCop || 0)),
            methodLabel: payment.methodLabel || 'Anulación de Nómina',
        })),
        items: [{
            name: `Anulación nómina: ${settlement.employeeNombre}`,
            qty: 1,
            priceUsd: Math.abs(Number(originalMovement?.items?.[0]?.priceUsd ?? settlement.netoAPagarUsd)),
            costBs: Math.abs(Number(originalMovement?.items?.[0]?.costBs ?? settlement.netoAPagarBs)),
        }],
        actor: clone(actor),
        usuarioId: actor.id,
        usuarioNombre: actor.nombre,
        usuarioRol: actor.rol,
        deviceId: getDeviceId(),
    };
}

async function getOrCreatePayrollPeriodUnlocked(inputDate = new Date()) {
    const candidate = getPayrollPeriodForDate(inputDate);
    const periods = await getArray(EMPLOYEE_KEYS.PERIODS);
    const existing = periods.find(period => period?.id === candidate.id);
    if (existing) return normalizePayrollPeriod(existing);
    const created = {
        ...candidate,
        employeeSnapshots: {},
        createdAt: new Date().toISOString(),
        closedAt: null,
        closedBy: null,
    };
    await persistAndVerify(EMPLOYEE_KEYS.PERIODS, [created, ...periods]);
    return created;
}

/** Congela salario y límite la primera vez que el empleado participa del período. */
async function ensurePayrollEmployeeSnapshotUnlocked(period, employee) {
    const normalizedPeriod = normalizePayrollPeriod(period);
    const employeeId = String(employee?.id || '');
    if (!employeeId) throw new Error('Empleado inválido para snapshot de nómina');
    const snapshots = normalizedPeriod.employeeSnapshots || {};
    if (snapshots[employeeId]?.salarioSemanalUsd !== undefined) return normalizedPeriod;

    const snapshot = getPayrollEmployeeSnapshot(employee, null);
    const updatedPeriod = {
        ...normalizedPeriod,
        employeeSnapshots: {
            ...snapshots,
            [employeeId]: {
                employeeId,
                employeeNombre: snapshot.employeeNombre,
                cargo: snapshot.cargo,
                salarioSemanalUsd: snapshot.salarioSemanalUsd,
                limiteConsumoPorc: snapshot.limiteConsumoPorc,
                capturedAt: new Date().toISOString(),
            },
        },
    };
    const periods = await getArray(EMPLOYEE_KEYS.PERIODS);
    const nextPeriods = periods.some(item => item?.id === normalizedPeriod.id)
        ? periods.map(item => item?.id === normalizedPeriod.id ? updatedPeriod : item)
        : [updatedPeriod, ...periods];
    await persistAndVerify(EMPLOYEE_KEYS.PERIODS, nextPeriods);
    return updatedPeriod;
}

async function refreshPayrollPeriodStatusUnlocked(period) {
    const normalizedPeriod = normalizePayrollPeriod(period);
    const employees = (await getArray(EMPLOYEE_KEYS.EMPLOYEES)).map(normalizeEmployee);
    const settlements = await getArray(EMPLOYEE_KEYS.SETTLEMENTS);
    const consumptions = await getArray(EMPLOYEE_KEYS.CONSUMPTIONS);
    const pendingConsumptions = consumptions.some(item => (
        item?.periodoId === normalizedPeriod.id
        && (item.status === EMPLOYEE_STATUS.PENDING || item.status === EMPLOYEE_STATUS.FAILED_RETRYABLE)
    ));
    const relevantEmployees = employees.filter(employee => (
        employee.activo
        || settlements.some(item => item?.employeeId === employee.id && item?.periodoId === normalizedPeriod.id)
        || consumptions.some(item => item?.employeeId === employee.id && item?.periodoId === normalizedPeriod.id)
    ));
    const allSettled = relevantEmployees.length > 0 && relevantEmployees.every(employee => settlements.some(item => (
        item?.employeeId === employee.id
        && item?.periodoId === normalizedPeriod.id
        && item?.status === SETTLEMENT_STATUS.PAID
    )));
    const nextStatus = pendingConsumptions
        ? PERIOD_STATUS.CLOSED_WITH_PENDING_ITEMS
        : allSettled ? PERIOD_STATUS.SETTLED : PERIOD_STATUS.OPEN;
    if (normalizedPeriod.status === nextStatus) return normalizedPeriod;

    const updated = {
        ...normalizedPeriod,
        status: nextStatus,
        closedAt: nextStatus === PERIOD_STATUS.SETTLED ? (normalizedPeriod.closedAt || new Date().toISOString()) : null,
        closedBy: nextStatus === PERIOD_STATUS.SETTLED ? (normalizedPeriod.closedBy || getActiveActor()) : null,
    };
    const periods = await getArray(EMPLOYEE_KEYS.PERIODS);
    await persistAndVerify(EMPLOYEE_KEYS.PERIODS, periods.some(item => item?.id === updated.id)
        ? periods.map(item => item?.id === updated.id ? updated : item)
        : [updated, ...periods]);
    return updated;
}

async function refreshPayrollProjectionUnlocked(period = null) {
    let activePeriod = period || await getOrCreatePayrollPeriodUnlocked(new Date());
    const employees = (await getArray(EMPLOYEE_KEYS.EMPLOYEES)).map(normalizeEmployee);
    const consumptions = await getArray(EMPLOYEE_KEYS.CONSUMPTIONS);
    const settlements = await getArray(EMPLOYEE_KEYS.SETTLEMENTS);
    const summaries = [];

    for (const employee of employees.filter(item => item.activo || consumptions.some(consumption => (
        consumption?.employeeId === item.id && consumption?.periodoId === activePeriod.id
    )))) {
        activePeriod = await ensurePayrollEmployeeSnapshotUnlocked(activePeriod, employee);
        const summary = calculatePayrollSummary(employee, activePeriod, consumptions, { includeSettled: true });
        const settled = settlements.find(item => (
            item?.employeeId === employee.id
            && item?.periodoId === activePeriod.id
            && item?.status === SETTLEMENT_STATUS.PAID
        ));
        summaries.push({
            ...summary,
            settled: Boolean(settled),
            settlementId: settled?.id || null,
        });
    }

    activePeriod = await refreshPayrollPeriodStatusUnlocked(activePeriod);
    const projection = {
        version: 1,
        generatedAt: new Date().toISOString(),
        periodo: activePeriod,
        employees: summaries,
        totals: {
            nominaTotalUsd: sumR(summaries.map(item => item.salarioSemanalUsd)),
            consumosTotalUsd: sumR(summaries.map(item => item.totalConsumosUsd)),
            netoTotalUsd: sumR(summaries.map(item => item.netoAPagarUsd)),
            employeesCount: summaries.length,
        },
    };
    await persistAndVerify(EMPLOYEE_KEYS.PROJECTION, projection);
    return projection;
}

async function markConsumptionStatusUnlocked(consumptions, consumptionId, patch) {
    const updated = consumptions.map(item => item.id === consumptionId
        ? { ...item, ...patch, updatedAt: new Date().toISOString() }
        : item);
    await persistAndVerify(EMPLOYEE_KEYS.CONSUMPTIONS, updated);
    return updated;
}

async function recoverSettlementUnlocked(settlement, actor) {
    const consumptions = await getArray(EMPLOYEE_KEYS.CONSUMPTIONS);
    let sales = await getArray(SALES_KEY);
    const requiresMovement = Boolean(settlement.cashMovementId);
    let hasMovement = requiresMovement && sales.some(item => item?.id === settlement.cashMovementId);
    let recoveryError = null;

    // Un settlement PENDING puede haber quedado después de persistir el
    // settlement, pero antes del movimiento espejo. Recrearlo con el mismo ID
    // hace que el recovery sea idempotente y evita pagar dos veces.
    if (requiresMovement && !hasMovement) {
        try {
            const employee = { id: settlement.employeeId, nombre: settlement.employeeNombre || 'Empleado' };
            const payments = Array.isArray(settlement.payments) ? settlement.payments : [];
            const cashMovement = buildPayrollCashMovement(settlement, employee, payments, settlement.actor || actor);
            sales = [cashMovement, ...sales.filter(item => item?.id !== cashMovement.id)];
            await persistAndVerify(SALES_KEY, sales);
            hasMovement = true;
        } catch (error) {
            recoveryError = error?.message || String(error);
        }
    }

    const settled = !requiresMovement || hasMovement;
    const settledAt = settled ? (settlement.paidAt || new Date().toISOString()) : null;
    const updatedConsumptions = consumptions.map(item => (
        settled
        && settlement.consumptionIds?.includes(item.id)
        && item.status === EMPLOYEE_STATUS.APPLIED
            ? { ...item, settlementId: settlement.id, updatedAt: new Date().toISOString() }
            : item
    ));
    await persistAndVerify(EMPLOYEE_KEYS.CONSUMPTIONS, updatedConsumptions);
    return {
        ...settlement,
        status: settled ? SETTLEMENT_STATUS.PAID : SETTLEMENT_STATUS.FAILED_RETRYABLE,
        paidAt: settledAt,
        actor: settlement.actor || actor,
        recoveryError,
        updatedAt: new Date().toISOString(),
    };
}

export async function getEmployees() {
    return (await getArray(EMPLOYEE_KEYS.EMPLOYEES)).map(normalizeEmployee);
}

export async function getEmployeeConsumptions(filters = {}) {
    const list = await getArray(EMPLOYEE_KEYS.CONSUMPTIONS);
    return list.filter(item => (
        (!filters.employeeId || String(item.employeeId) === String(filters.employeeId))
        && (!filters.periodoId || item.periodoId === filters.periodoId)
        && (!filters.status || item.status === filters.status)
    ));
}

export async function getPayrollSettlements(filters = {}) {
    const list = (await getArray(EMPLOYEE_KEYS.SETTLEMENTS)).map(normalizePayrollSettlement);
    return list.filter(item => (
        (!filters.employeeId || String(item.employeeId) === String(filters.employeeId))
        && (!filters.periodoId || item.periodoId === filters.periodoId)
        && (!filters.status || item.status === filters.status)
    ));
}

export async function getPayrollPeriod(periodId = null, date = new Date()) {
    const periods = await getArray(EMPLOYEE_KEYS.PERIODS);
    const candidate = periodId || getPayrollPeriodForDate(date).id;
    const found = periods.find(period => period?.id === candidate);
    return found ? normalizePayrollPeriod(found) : getPayrollPeriodForDate(date);
}

export async function getPayrollProjection() {
    const projection = await storageService.getItem(EMPLOYEE_KEYS.PROJECTION, null);
    if (projection?.employees && projection?.periodo) return projection;
    return await withLock('pos_write_lock', async () => refreshPayrollProjectionUnlocked());
}

export async function saveEmployee(rawEmployee) {
    const actor = assertRole(['ADMIN'], 'gestionar empleados');
    return await withLock('pos_write_lock', async () => {
        const normalized = normalizeEmployee(rawEmployee);
        validateEmployeeInput(normalized);
        const employees = await getEmployees();
        const duplicateCedula = normalized.cedula && employees.some(item => (
            item.id !== normalized.id && item.cedula && item.cedula === normalized.cedula
        ));
        if (duplicateCedula) throw new Error('Ya existe un empleado con esa cédula');
        const exists = employees.some(item => item.id === normalized.id);
        const updated = exists
            ? employees.map(item => item.id === normalized.id ? normalized : item)
            : [normalized, ...employees];
        await persistAndVerify(EMPLOYEE_KEYS.EMPLOYEES, updated);
        await refreshPayrollProjectionUnlocked();
        await logEvent('USUARIO', exists ? 'EMPLEADO_ACTUALIZADO' : 'EMPLEADO_CREADO',
            `${exists ? 'Actualizado' : 'Creado'} empleado "${normalized.nombre}"`, actor,
            { employeeId: normalized.id });
        return normalized;
    });
}

export async function deactivateEmployee(employeeId) {
    const actor = assertRole(['ADMIN'], 'desactivar empleados');
    return await withLock('pos_write_lock', async () => {
        const employees = await getEmployees();
        const target = findEmployee(employees, employeeId);
        if (!target) throw new Error('Empleado no encontrado');
        const updatedEmployee = normalizeEmployee({
            ...target,
            activo: false,
            deactivatedAt: new Date().toISOString(),
            deactivatedBy: actor,
        });
        await persistAndVerify(EMPLOYEE_KEYS.EMPLOYEES, employees.map(item => (
            item.id === target.id ? updatedEmployee : item
        )));
        await refreshPayrollProjectionUnlocked();
        await logEvent('USUARIO', 'EMPLEADO_DESACTIVADO',
            `Desactivado empleado "${target.nombre}"`, actor,
            { employeeId: target.id });
        return updatedEmployee;
    });
}

export async function deleteEmployee(employeeId) {
    const actor = assertRole(['ADMIN'], 'eliminar empleados');
    return await withLock('pos_write_lock', async () => {
        const employees = await getEmployees();
        const target = findEmployee(employees, employeeId);
        if (!target) throw new Error('Empleado no encontrado');
        
        const nextEmployees = employees.filter(item => String(item.id) !== String(employeeId));
        await persistAndVerify(EMPLOYEE_KEYS.EMPLOYEES, nextEmployees);
        await refreshPayrollProjectionUnlocked();
        await logEvent('USUARIO', 'EMPLEADO_ELIMINADO',
            `Eliminado definitivamente empleado "${target.nombre}"`, actor,
            { employeeId: target.id });
        return { success: true, deletedEmployee: target };
    });
}

export async function getEmployeePayrollSummary(employeeId, periodId = null) {
    return await withLock('pos_write_lock', async () => {
        const employees = await getEmployees();
        const employee = findEmployee(employees, employeeId);
        if (!employee) throw new Error('Empleado no encontrado');
        let period = periodId
            ? await getPayrollPeriod(periodId)
            : await getOrCreatePayrollPeriodUnlocked(new Date());
        period = await ensurePayrollEmployeeSnapshotUnlocked(period, employee);
        const consumptions = await getEmployeeConsumptions({ employeeId, periodoId: period.id });
        const summary = calculatePayrollSummary(employee, period, consumptions);
        const settlements = await getPayrollSettlements({ employeeId, periodoId: period.id, status: SETTLEMENT_STATUS.PAID });
        return {
            ...summary,
            settled: settlements.length > 0,
            settlementId: settlements[0]?.id || null,
        };
    });
}

export async function registerEmployeeConsumption(input = {}) {
    const actor = assertRole(['ADMIN', 'CAJERO'], 'registrar consumos de empleados');
    return await withLock('pos_write_lock', async () => registerEmployeeConsumptionUnlocked(input, actor));
}

export async function registerEmployeeConsumptionUnlocked(input = {}, actor = getActiveActor()) {
    const employees = await getEmployees();
    const employee = findEmployee(employees, input.employeeId);
    if (!employee || !employee.activo) throw new Error('El empleado no está activo o no existe');

    let period = input.periodoId
        ? await getPayrollPeriod(input.periodoId)
        : await getOrCreatePayrollPeriodUnlocked(new Date(input.timestamp || Date.now()));
    period = await ensurePayrollEmployeeSnapshotUnlocked(period, employee);
    if (input.timestamp && !isDateInPayrollPeriod(input.timestamp, period)) {
        throw new Error('El timestamp del consumo no pertenece al período de nómina solicitado');
    }
    const idempotencyKey = input.idempotencyKey || input.requestId || null;
    const existing = idempotencyKey
        ? (await getArray(EMPLOYEE_KEYS.CONSUMPTIONS)).find(item => item.idempotencyKey === idempotencyKey)
        : null;
    if (existing?.status === EMPLOYEE_STATUS.APPLIED) return { success: true, idempotent: true, consumption: existing };

    const existingSettlements = await getArray(EMPLOYEE_KEYS.SETTLEMENTS);
    if (existingSettlements.some(item => (
        item?.employeeId === employee.id
        && item?.periodoId === period.id
        && item?.status === SETTLEMENT_STATUS.PAID
    ))) {
        throw new Error('El período de nómina de este empleado ya fue liquidado');
    }
    const products = await getArray(PRODUCTS_KEY);
    const rawItems = Array.isArray(input.items) ? input.items : [];
    if (rawItems.length === 0) throw new Error('Selecciona al menos un producto');

    const snapshots = rawItems.map(rawItem => {
        const product = products.find(item => String(item?.id) === String(rawItem.productId || rawItem.id));
        if (!product) throw new Error(`Producto no encontrado: ${rawItem.productId || rawItem.id}`);
        const qty = round3(Number(rawItem.qty));
        const currentStock = Number(product.stock) || 0;
        if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Cantidad inválida para ${product.name}`);
        if (currentStock < qty) {
            throw new Error(`Stock insuficiente para "${product.name}". Disponible: ${currentStock}`);
        }
        return normalizeProductItem(product, { ...rawItem, qty });
    });

    const totalUsd = sumR(snapshots.map(item => mulR(item.priceUsd, item.qty)));
    const currentConsumptions = await getEmployeeConsumptions({
        employeeId: employee.id,
        periodoId: period.id,
        status: EMPLOYEE_STATUS.APPLIED,
    });
    const limitCheck = validateConsumptionLimit(
        employee,
        currentConsumptions,
        sumR([...
            currentConsumptions.map(item => Number(item.totalUsd) || 0),
            totalUsd,
        ]),
        {
            override: input.overrideLimit === true,
            actor,
            employeeSnapshot: getPayrollEmployeeSnapshot(employee, period),
        },
    );
    if (!limitCheck.allowed) {
        const error = new Error(limitCheck.error);
        error.code = 'EMPLOYEE_CONSUMPTION_LIMIT_EXCEEDED';
        throw error;
    }

    const timestamp = input.timestamp || new Date().toISOString();
    const consumption = normalizeConsumption({
        ...(existing || {}),
        id: existing?.id || input.id || newId('employee_consumption'),
        idempotencyKey,
        employeeId: employee.id,
        employeeNombre: employee.nombre,
        periodoId: period.id,
        timestamp,
        status: EMPLOYEE_STATUS.PENDING,
        items: snapshots,
        totalUsd,
        totalBs: input.tasaBsPorUsd ? mulR(totalUsd, input.tasaBsPorUsd) : 0,
        tasaBsPorUsd: input.tasaBsPorUsd || 0,
        tasaFuente: input.tasaFuente || 'BCV',
        tasaCapturadaAt: timestamp,
        inventoryOperationId: existing?.inventoryOperationId || `employee_consumption_${existing?.id || input.id || newId()}`,
        settlementId: null,
        nota: input.nota || '',
        actor,
        deviceId: getDeviceId(),
        limitOverride: limitCheck.authorizedOverride === true,
    });

    const consumptions = await getArray(EMPLOYEE_KEYS.CONSUMPTIONS);
    const hasExisting = consumptions.some(item => item.id === consumption.id);
    const pendingList = hasExisting
        ? consumptions.map(item => item.id === consumption.id ? consumption : item)
        : [consumption, ...consumptions];
    await persistAndVerify(EMPLOYEE_KEYS.CONSUMPTIONS, pendingList);

    const inventoryResult = await applyInventoryOperationUnlocked(buildInventoryRequest(consumption, actor));
    if (!inventoryResult.success) {
        const failed = pendingList.map(item => item.id === consumption.id
            ? { ...item, status: EMPLOYEE_STATUS.FAILED_RETRYABLE, updatedAt: new Date().toISOString() }
            : item);
        await persistAndVerify(EMPLOYEE_KEYS.CONSUMPTIONS, failed);
        const failedConsumption = failed.find(item => item.id === consumption.id);
        return {
            success: false,
            pending: inventoryResult.pending === true,
            error: inventoryResult.error,
            consumption: failedConsumption,
        };
    }

    const applied = {
        ...consumption,
        status: EMPLOYEE_STATUS.APPLIED,
        updatedAt: new Date().toISOString(),
    };
    const appliedList = pendingList.map(item => item.id === consumption.id ? applied : item);
    await persistAndVerify(EMPLOYEE_KEYS.CONSUMPTIONS, appliedList);
    await refreshPayrollProjectionUnlocked(period);
    await logEvent('INVENTARIO', 'CONSUMO_EMPLEADO_REGISTRADO',
        `Consumo de ${applied.employeeNombre} por $${applied.totalUsd}`,
        actor,
        {
            consumptionId: applied.id,
            employeeId: applied.employeeId,
            periodoId: applied.periodoId,
            limitOverride: applied.limitOverride === true,
            limitUsd: limitCheck.limitUsd,
        });

    return {
        success: true,
        consumption: applied,
        updatedProducts: inventoryResult.updatedProducts,
        inventoryResult,
    };
}

export async function voidEmployeeConsumption(consumptionId, reason = '') {
    const actor = assertRole(['ADMIN'], 'anular consumos de empleados');
    return await withLock('pos_write_lock', async () => {
        const consumptions = await getArray(EMPLOYEE_KEYS.CONSUMPTIONS);
        const target = consumptions.find(item => item.id === consumptionId);
        if (!target) throw new Error('Consumo no encontrado');
        if (target.status !== EMPLOYEE_STATUS.APPLIED) throw new Error('El consumo no está aplicado');
        if (target.settlementId) throw new Error('No se puede anular un consumo ya liquidado');

        const inventoryResult = await applyInventoryOperationUnlocked({
            operationId: `void_${target.inventoryOperationId}`,
            referenceId: target.id,
            referenceType: 'ANULACION_CONSUMO_EMPLEADO',
            source: 'CONSUMO_EMPLEADO',
            tipo: 'DEVOLUCION',
            subtipo: 'ANULACION_CONSUMO_EMPLEADO',
            reason: reason || 'Anulación de consumo de empleado',
            allowNegative: true,
            actor,
            deductions: target.items.map(item => ({
                productoId: item.productId,
                cantidad: Math.abs(Number(item.qty)),
                unidad: item.unit,
                origen: 'DEVOLUCION',
            })),
            metadata: { consumptionId: target.id, employeeId: target.employeeId },
        });
        if (!inventoryResult.success) throw new Error(inventoryResult.error || 'No se pudo devolver el inventario');

        const updated = await markConsumptionStatusUnlocked(consumptions, target.id, {
            status: EMPLOYEE_STATUS.VOIDED,
            voidedAt: new Date().toISOString(),
            voidedBy: actor,
            voidReason: reason || 'Anulación de consumo de empleado',
        });
        await refreshPayrollProjectionUnlocked(await getPayrollPeriod(target.periodoId));
        await logEvent('INVENTARIO', 'CONSUMO_EMPLEADO_ANULADO',
            `Anulado consumo de ${target.employeeNombre}`, actor,
            { consumptionId: target.id, employeeId: target.employeeId });
        return {
            success: true,
            consumption: updated.find(item => item.id === target.id),
            inventoryResult,
        };
    });
}

export async function settleEmployeePayroll(input = {}) {
    const actor = assertRole(['ADMIN'], 'liquidar nómina');
    return await withLock('pos_write_lock', async () => settleEmployeePayrollUnlocked(input, actor));
}

export async function voidEmployeePayrollSettlement(settlementId, reason = '') {
    const actor = assertRole(['ADMIN'], 'anular liquidaciones de nómina');
    return await withLock('pos_write_lock', async () => {
        const settlements = await getArray(EMPLOYEE_KEYS.SETTLEMENTS);
        const target = settlements.find(item => item?.id === settlementId);
        if (!target) throw new Error('Liquidación de nómina no encontrada');
        if (target.status === SETTLEMENT_STATUS.VOIDED) {
            return { success: true, idempotent: true, settlement: target };
        }
        if (target.status !== SETTLEMENT_STATUS.PAID) {
            throw new Error('Solo se puede anular una liquidación pagada');
        }

        let sales = await getArray(SALES_KEY);
        const originalMovement = target.cashMovementId
            ? sales.find(item => item?.id === target.cashMovementId)
            : null;
        if (target.cashMovementId && !originalMovement) {
            throw new Error('No se puede anular la liquidación: falta el movimiento financiero original');
        }
        if (originalMovement?.afectaCaja === true && !findOpenApertura(sales)) {
            throw new Error('La caja debe estar abierta para registrar la reversión en efectivo');
        }

        const voidReason = reason || 'Anulación de liquidación de nómina';
        const reversal = buildPayrollVoidMovement(
            { ...target, voidReason },
            originalMovement,
            actor,
        );
        if (!sales.some(item => item?.id === reversal.id)) {
            sales = [reversal, ...sales];
            await persistAndVerify(SALES_KEY, sales);
        }

        const consumptions = await getArray(EMPLOYEE_KEYS.CONSUMPTIONS);
        const updatedConsumptions = consumptions.map(item => (
            item?.settlementId === target.id
                ? { ...item, settlementId: null, updatedAt: new Date().toISOString() }
                : item
        ));
        await persistAndVerify(EMPLOYEE_KEYS.CONSUMPTIONS, updatedConsumptions);

        const voided = {
            ...target,
            status: SETTLEMENT_STATUS.VOIDED,
            cashReversalMovementId: reversal.id,
            voidedAt: new Date().toISOString(),
            voidedBy: actor,
            voidReason,
            updatedAt: new Date().toISOString(),
        };
        await persistAndVerify(EMPLOYEE_KEYS.SETTLEMENTS, settlements.map(item => (
            item.id === target.id ? voided : item
        )));
        const period = await refreshPayrollPeriodStatusUnlocked(await getPayrollPeriod(target.periodoId));
        await refreshPayrollProjectionUnlocked(period);
        await logEvent('PAGO', 'NOMINA_ANULADA',
            `Anulada liquidación de nómina para ${target.employeeNombre}`,
            actor,
            { settlementId: target.id, employeeId: target.employeeId, periodoId: target.periodoId, reversalId: reversal.id });

        return { success: true, settlement: voided, reversal };
    });
}

export async function settleEmployeePayrollUnlocked(input = {}, actor = getActiveActor()) {
    const employees = await getEmployees();
    const employee = findEmployee(employees, input.employeeId);
    if (!employee) throw new Error('Empleado no encontrado');
    let period = await getPayrollPeriod(input.periodoId);
    period = await ensurePayrollEmployeeSnapshotUnlocked(period, employee);
    const settlements = await getArray(EMPLOYEE_KEYS.SETTLEMENTS);
    const idempotencyKey = input.idempotencyKey || `settle_${employee.id}_${period.id}`;
    const paidSettlement = settlements.find(item => (
        item.idempotencyKey === idempotencyKey
        || (item.employeeId === employee.id && item.periodoId === period.id && item.status === SETTLEMENT_STATUS.PAID)
    ));
    if (paidSettlement) return { success: true, idempotent: true, settlement: paidSettlement };

    const existing = settlements.find(item => (
        item.idempotencyKey === idempotencyKey
        && (item.status === SETTLEMENT_STATUS.PENDING || item.status === SETTLEMENT_STATUS.FAILED_RETRYABLE)
    ));
    const conflictingPending = settlements.find(item => (
        item.id !== existing?.id
        && item.employeeId === employee.id
        && item.periodoId === period.id
        && (item.status === SETTLEMENT_STATUS.PENDING || item.status === SETTLEMENT_STATUS.FAILED_RETRYABLE)
    ));
    if (conflictingPending) {
        throw new Error('Ya existe una liquidación de nómina pendiente de recuperación para este empleado y período');
    }

    const consumptions = await getEmployeeConsumptions({ employeeId: employee.id, periodoId: period.id });
    const applicable = consumptions.filter(item => (
        item.status === EMPLOYEE_STATUS.APPLIED && !item.settlementId
    ));
    const settlementRate = Number(existing?.tasaBcv || input.tasaBcv);
    if (!(settlementRate > 0)) throw new Error('La tasa BCV para liquidar nómina debe ser mayor que cero');
    const amounts = calculateSettlementAmounts(employee, applicable, settlementRate, period);
    if (amounts.netoAPagarUsd < 0) throw new Error('El neto a pagar no puede ser negativo');

    const payments = await normalizePayrollPayments(input.payments?.length > 0
        ? input.payments
        : existing?.payments?.length > 0
            ? existing.payments
            : buildPayrollPayments(input.metodoPago, input.currency, amounts), amounts);
    const hasCash = payments.some(payment => payment.isCash === true);
    if (hasCash) {
        const sales = await getArray(SALES_KEY);
        if (!findOpenApertura(sales)) {
            throw new Error('La caja debe estar abierta para pagar nómina en efectivo');
        }
    }

    const settlementId = existing?.id || input.id || newId('payroll_settlement');
    const settlement = {
        ...(existing || {}),
        id: settlementId,
        employeeId: employee.id,
        employeeNombre: employee.nombre,
        periodoId: period.id,
        periodoInicio: period.periodoInicio,
        periodoFin: period.periodoFin,
        ...amounts,
        payments,
        status: SETTLEMENT_STATUS.PENDING,
        paidAt: null,
        consumptionIds: applicable.map(item => item.id),
        cashMovementId: `payroll_cash_${settlementId}`,
        idempotencyKey,
        nota: input.nota || '',
        actor,
        deviceId: getDeviceId(),
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    const pendingSettlements = settlements.some(item => item.id === settlement.id)
        ? settlements.map(item => item.id === settlement.id ? settlement : item)
        : [settlement, ...settlements];
    await persistAndVerify(EMPLOYEE_KEYS.SETTLEMENTS, pendingSettlements);

    const cashMovement = buildPayrollCashMovement(settlement, employee, payments, actor);
    const sales = await getArray(SALES_KEY);
    const salesWithoutMovement = sales.filter(item => item.id !== cashMovement.id);
    await persistAndVerify(SALES_KEY, [cashMovement, ...salesWithoutMovement]);

    const settledAt = new Date().toISOString();
    const updatedConsumptions = consumptions.map(item => (
        settlement.consumptionIds.includes(item.id)
            ? { ...item, settlementId: settlement.id, updatedAt: settledAt }
            : item
    ));
    await persistAndVerify(EMPLOYEE_KEYS.CONSUMPTIONS, updatedConsumptions);

    const paid = { ...settlement, status: SETTLEMENT_STATUS.PAID, paidAt: settledAt, updatedAt: settledAt };
    const paidSettlements = pendingSettlements.map(item => item.id === settlement.id ? paid : item);
    await persistAndVerify(EMPLOYEE_KEYS.SETTLEMENTS, paidSettlements);
    period = await refreshPayrollPeriodStatusUnlocked(period);
    await refreshPayrollProjectionUnlocked(period);
    await logEvent('PAGO', 'NOMINA_LIQUIDADA',
        `Nómina liquidada para ${employee.nombre} por $${paid.netoAPagarUsd}`,
        actor,
        { settlementId: paid.id, employeeId: employee.id, periodoId: period.id });

    return { success: true, settlement: paid, cashMovement };
}

export async function recoverPendingEmployeeOperations() {
    const actor = getActiveActor();
    return await withLock('pos_write_lock', async () => recoverPendingEmployeeOperationsUnlocked(actor));
}

export async function recoverPendingEmployeeOperationsUnlocked(actor = getActiveActor()) {
    const results = [];
    const inventoryOperations = await getInventoryOperations();
    let consumptions = await getArray(EMPLOYEE_KEYS.CONSUMPTIONS);
    let settlements = await getArray(EMPLOYEE_KEYS.SETTLEMENTS);

    for (const target of consumptions.filter(item => (
        (item.status === EMPLOYEE_STATUS.PENDING || item.status === EMPLOYEE_STATUS.FAILED_RETRYABLE)
        && item.inventoryOperationId
    ))) {
        const operation = inventoryOperations.find(item => item.operationId === target.inventoryOperationId);
        let result;
        if (operation?.status === 'APPLIED_LOCAL') {
            result = { success: true, idempotent: true, consumption: target };
        } else {
            const inventoryResult = await applyInventoryOperationUnlocked(buildInventoryRequest(target, target.actor || actor));
            result = inventoryResult.success
                ? { success: true, consumption: target, inventoryResult }
                : { success: false, pending: inventoryResult.pending, error: inventoryResult.error };
        }
        if (result.success) {
            consumptions = consumptions.map(item => item.id === target.id
                ? { ...item, status: EMPLOYEE_STATUS.APPLIED, updatedAt: new Date().toISOString() }
                : item);
            results.push({ ...result, consumptionId: target.id });
        } else {
            results.push({ ...result, consumptionId: target.id });
        }
    }
    await persistAndVerify(EMPLOYEE_KEYS.CONSUMPTIONS, consumptions);

    for (const target of settlements.filter(item => (
        item.status === SETTLEMENT_STATUS.PENDING
        || item.status === SETTLEMENT_STATUS.FAILED_RETRYABLE
    ))) {
        const recovered = await recoverSettlementUnlocked(target, actor);
        settlements = settlements.map(item => item.id === target.id ? recovered : item);
        results.push({ success: recovered.status === SETTLEMENT_STATUS.PAID, settlementId: target.id, settlement: recovered });
    }
    await persistAndVerify(EMPLOYEE_KEYS.SETTLEMENTS, settlements);
    await refreshPayrollProjectionUnlocked();
    return results;
}

export async function getEmployeeHistory(employeeId, periodId = null) {
    return await getEmployeeConsumptions({ employeeId, periodoId: periodId });
}

export { buildPayrollPayments, buildPayrollCashMovement };
