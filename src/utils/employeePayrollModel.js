import { round2, round3, mulR, divR, sumR, subR } from './dinero';

export const EMPLOYEE_KEYS = Object.freeze({
    EMPLOYEES: 'bodega_employees_v1',
    CONSUMPTIONS: 'bodega_employee_consumptions_v1',
    PERIODS: 'bodega_payroll_periods_v1',
    SETTLEMENTS: 'bodega_payroll_settlements_v1',
    PROJECTION: 'bodega_employee_payroll_projection_v1',
});

export const EMPLOYEE_STATUS = Object.freeze({
    PENDING: 'PENDING',
    APPLIED: 'APPLIED',
    VOIDED: 'VOIDED',
    FAILED_RETRYABLE: 'FAILED_RETRYABLE',
});

export const SETTLEMENT_STATUS = Object.freeze({
    PENDING: 'PENDING',
    PAID: 'PAID',
    VOIDED: 'VOIDED',
    FAILED_RETRYABLE: 'FAILED_RETRYABLE',
});

export const PERIOD_STATUS = Object.freeze({
    OPEN: 'OPEN',
    SETTLED: 'SETTLED',
    CLOSED_WITH_PENDING_ITEMS: 'CLOSED_WITH_PENDING_ITEMS',
});

export const PAYROLL_TIME_ZONE = 'America/Caracas';

function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value) {
    return Math.max(0, finiteNumber(value));
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function getZonedParts(date, timeZone = PAYROLL_TIME_ZONE) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(date).map(part => [part.type, part.value])
    );
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
    };
}

/** Convierte una fecha calendario de una zona horaria a un instante UTC. */
function zonedDateTimeToUtc(parts, timeZone = PAYROLL_TIME_ZONE) {
    const target = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour || 0,
        parts.minute || 0,
        parts.second || 0,
        parts.millisecond || 0,
    );
    let guess = target;

    // Tres iteraciones bastan para resolver offsets normales y cambios de horario.
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const observed = getZonedParts(new Date(guess), timeZone);
        const observedUtc = Date.UTC(
            observed.year,
            observed.month - 1,
            observed.day,
            observed.hour,
            observed.minute,
            observed.second,
        );
        guess += target - observedUtc;
    }
    return new Date(guess);
}

function calendarStartForDate(date, timeZone = PAYROLL_TIME_ZONE) {
    const parts = getZonedParts(date instanceof Date ? date : new Date(date), timeZone);
    const noonUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
    const dayOfWeek = noonUtc.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day - daysSinceMonday,
        0,
        0,
        0,
    ));
    return {
        year: monday.getUTCFullYear(),
        month: monday.getUTCMonth() + 1,
        day: monday.getUTCDate(),
    };
}

export function getPayrollPeriodForDate(input = new Date(), timeZone = PAYROLL_TIME_ZONE) {
    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) throw new Error('Fecha inválida para período de nómina');

    const startCalendar = calendarStartForDate(date, timeZone);
    const periodStart = zonedDateTimeToUtc({ ...startCalendar, hour: 0 }, timeZone);
    const nextMondayCalendarDate = new Date(Date.UTC(
        startCalendar.year,
        startCalendar.month - 1,
        startCalendar.day + 7,
        0,
        0,
        0,
    ));
    const periodEnd = zonedDateTimeToUtc({
        year: nextMondayCalendarDate.getUTCFullYear(),
        month: nextMondayCalendarDate.getUTCMonth() + 1,
        day: nextMondayCalendarDate.getUTCDate(),
        hour: 0,
    }, timeZone);

    const id = [
        startCalendar.year,
        pad(startCalendar.month),
        pad(startCalendar.day),
    ].join('-');

    return {
        id,
        periodoId: id,
        periodoInicio: periodStart.toISOString(),
        periodoFin: periodEnd.toISOString(),
        zonaHoraria: timeZone,
        status: PERIOD_STATUS.OPEN,
    };
}

export function isDateInPayrollPeriod(date, period) {
    if (!period?.periodoInicio || !period?.periodoFin) return false;
    const timestamp = (date instanceof Date ? date : new Date(date)).getTime();
    const start = new Date(period.periodoInicio).getTime();
    const end = new Date(period.periodoFin).getTime();
    return Number.isFinite(timestamp) && Number.isFinite(start) && Number.isFinite(end)
        && timestamp >= start && timestamp < end;
}

/**
 * Devuelve el salario/límite congelados para un empleado dentro del período.
 * Los períodos antiguos sin snapshot hacen fallback al catálogo actual y el
 * servicio los materializa antes de cualquier operación que modifique dinero.
 */
export function getPayrollEmployeeSnapshot(employee = {}, period = null) {
    const stored = period?.employeeSnapshots?.[employee?.id];
    return {
        employeeId: employee?.id || null,
        employeeNombre: stored?.employeeNombre || employee?.nombre || '',
        cargo: stored?.cargo || employee?.cargo || '',
        salarioSemanalUsd: round2(positiveNumber(stored?.salarioSemanalUsd ?? employee?.salarioSemanalUsd)),
        limiteConsumoPorc: normalizeLimitPercentage(
            stored?.limiteConsumoPorc ?? employee?.limiteConsumoPorc,
            100,
        ),
        capturedAt: stored?.capturedAt || null,
    };
}

export function normalizeLimitPercentage(value, fallback = 100) {
    const number = finiteNumber(value, fallback);
    return Math.min(100, Math.max(0, round2(number)));
}

export function getConsumptionLimitUsd(employee = {}, snapshot = null) {
    const source = snapshot || employee;
    const salary = positiveNumber(source.salarioSemanalUsd);
    const percentage = normalizeLimitPercentage(source.limiteConsumoPorc, 100);
    return mulR(salary, divR(percentage, 100));
}

export function calculateConsumptionTotal(consumptions = []) {
    return sumR((Array.isArray(consumptions) ? consumptions : [])
        .filter(item => item?.status === EMPLOYEE_STATUS.APPLIED)
        .map(item => positiveNumber(item.totalUsd)));
}

export function calculatePayrollSummary(employee, period, consumptions = [], options = {}) {
    const includeSettled = options.includeSettled === true;
    const relevant = (Array.isArray(consumptions) ? consumptions : []).filter(consumption => (
        consumption?.employeeId === employee?.id
        && consumption?.periodoId === period?.id
        && consumption?.status === EMPLOYEE_STATUS.APPLIED
        && (includeSettled || !consumption?.settlementId)
    ));
    const snapshot = getPayrollEmployeeSnapshot(employee, period);
    const salarioSemanalUsd = snapshot.salarioSemanalUsd;
    const totalConsumosUsd = calculateConsumptionTotal(relevant);
    const limiteConsumoUsd = getConsumptionLimitUsd(employee, snapshot);
    const netoAPagarUsd = subR(salarioSemanalUsd, totalConsumosUsd);
    const porcentajeConsumido = salarioSemanalUsd > 0
        ? round2((totalConsumosUsd / salarioSemanalUsd) * 100)
        : 0;

    return {
        employeeId: employee?.id || null,
        employeeNombre: snapshot.employeeNombre,
        cargo: snapshot.cargo,
        periodoId: period?.id || null,
        periodoInicio: period?.periodoInicio || null,
        periodoFin: period?.periodoFin || null,
        salarioSemanalUsd,
        totalConsumosUsd,
        limiteConsumoPorc: snapshot.limiteConsumoPorc,
        limiteConsumoUsd,
        netoAPagarUsd,
        porcentajeConsumido,
        consumptionsCount: relevant.length,
        consumptionIds: relevant.map(item => item.id).filter(Boolean),
        exceedsLimit: totalConsumosUsd > limiteConsumoUsd,
        exceedsSalary: totalConsumosUsd > salarioSemanalUsd,
        canSettle: netoAPagarUsd >= 0 && relevant.every(item => item.status === EMPLOYEE_STATUS.APPLIED),
    };
}

export function validateConsumptionLimit(employee, currentConsumptions, proposedTotalUsd, options = {}) {
    const total = round2(positiveNumber(proposedTotalUsd));
    const limit = getConsumptionLimitUsd(employee, options.employeeSnapshot);
    const exceeds = total > limit;
    const authorized = options.override === true && options.actor?.rol === 'ADMIN';

    if (!exceeds) {
        return { allowed: true, exceedsLimit: false, limitUsd: limit, totalUsd: total };
    }

    if (authorized) {
        return {
            allowed: true,
            exceedsLimit: true,
            authorizedOverride: true,
            limitUsd: limit,
            totalUsd: total,
        };
    }

    return {
        allowed: false,
        exceedsLimit: true,
        limitUsd: limit,
        totalUsd: total,
        error: `El consumo supera el límite semanal de $${round2(limit)}. Se requiere autorización ADMIN.`,
        currentTotalUsd: calculateConsumptionTotal(currentConsumptions),
    };
}

export function calculateSettlementAmounts(employee, consumptions, tasaBcv, period = null) {
    const snapshot = getPayrollEmployeeSnapshot(employee, period);
    const salarioSemanalUsd = snapshot.salarioSemanalUsd;
    const totalConsumosUsd = calculateConsumptionTotal(consumptions);
    const netoAPagarUsd = subR(salarioSemanalUsd, totalConsumosUsd);
    const safeRate = positiveNumber(tasaBcv);
    const netoAPagarBs = safeRate > 0 ? mulR(netoAPagarUsd, safeRate) : 0;

    return {
        salarioSemanalUsd,
        totalConsumosUsd,
        netoAPagarUsd,
        netoAPagarBs,
        tasaBcv: round2(safeRate),
    };
}

export function normalizeActor(actor = {}) {
    return {
        id: actor?.id ?? actor?.usuarioId ?? actor?.userId ?? null,
        nombre: String(actor?.nombre || actor?.usuarioNombre || actor?.usuario || actor?.userName || 'Sistema'),
        rol: String(actor?.rol || actor?.usuarioRol || actor?.userRole || 'SYSTEM'),
    };
}

export function normalizeEmployee(raw = {}) {
    const now = new Date().toISOString();
    return {
        id: String(raw.id || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)),
        nombre: String(raw.nombre || '').trim(),
        cedula: raw.cedula ? String(raw.cedula).trim() : null,
        cargo: raw.cargo ? String(raw.cargo).trim() : null,
        userId: raw.userId !== undefined && raw.userId !== null && raw.userId !== '' ? raw.userId : null,
        usuarioNombre: raw.usuarioNombre ? String(raw.usuarioNombre).trim() : null,
        salarioSemanalUsd: round2(positiveNumber(raw.salarioSemanalUsd)),
        limiteConsumoPorc: normalizeLimitPercentage(raw.limiteConsumoPorc, 100),
        activo: raw.activo !== false,
        fechaIngreso: raw.fechaIngreso || null,
        createdAt: raw.createdAt || now,
        updatedAt: now,
        deactivatedAt: raw.activo === false ? (raw.deactivatedAt || now) : null,
        deactivatedBy: raw.deactivatedBy || null,
    };
}

export function normalizePayrollPeriod(raw = {}) {
    const fallback = getPayrollPeriodForDate(new Date());
    return {
        ...fallback,
        ...raw,
        id: raw.id || raw.periodoId || fallback.id,
        periodoId: raw.periodoId || raw.id || fallback.id,
        zonaHoraria: raw.zonaHoraria || PAYROLL_TIME_ZONE,
        employeeSnapshots: raw.employeeSnapshots && typeof raw.employeeSnapshots === 'object'
            ? raw.employeeSnapshots
            : {},
        status: raw.status || PERIOD_STATUS.OPEN,
        createdAt: raw.createdAt || null,
        closedAt: raw.closedAt || null,
        closedBy: raw.closedBy || null,
    };
}

export function normalizeConsumptionItem(item = {}) {
    return {
        productId: String(item.productId || item.id || ''),
        sku: item.sku ? String(item.sku) : '',
        name: String(item.name || item.productName || 'Producto'),
        qty: round3(positiveNumber(item.qty)),
        unit: String(item.unit || 'unidad'),
        priceUsd: round2(positiveNumber(item.priceUsd)),
        costUsd: round2(positiveNumber(item.costUsd)),
    };
}

export function normalizeConsumption(raw = {}) {
    const timestamp = raw.timestamp || raw.createdAt || new Date().toISOString();
    const items = (Array.isArray(raw.items) ? raw.items : [])
        .map(normalizeConsumptionItem)
        .filter(item => item.productId && item.qty > 0);
    const calculatedTotal = sumR(items.map(item => mulR(item.priceUsd, item.qty)));
    return {
        id: String(raw.id || crypto.randomUUID()),
        employeeId: String(raw.employeeId || ''),
        employeeNombre: String(raw.employeeNombre || ''),
        periodoId: String(raw.periodoId || ''),
        timestamp,
        status: raw.status || EMPLOYEE_STATUS.PENDING,
        items,
        totalUsd: round2(raw.totalUsd ?? calculatedTotal),
        totalBs: round2(positiveNumber(raw.totalBs)),
        tasaBsPorUsd: round2(positiveNumber(raw.tasaBsPorUsd)),
        tasaFuente: raw.tasaFuente || 'BCV',
        tasaCapturadaAt: raw.tasaCapturadaAt || timestamp,
        valoracion: 'venta',
        inventoryOperationId: raw.inventoryOperationId || null,
        settlementId: raw.settlementId || null,
        idempotencyKey: raw.idempotencyKey || null,
        limitOverride: raw.limitOverride === true,
        nota: raw.nota ? String(raw.nota).trim() : '',
        actor: normalizeActor(raw.actor),
        deviceId: raw.deviceId || 'CAJA_PRINCIPAL',
        createdAt: raw.createdAt || timestamp,
        updatedAt: raw.updatedAt || timestamp,
        voidedAt: raw.voidedAt || null,
        voidedBy: raw.voidedBy ? normalizeActor(raw.voidedBy) : null,
        voidReason: raw.voidReason || null,
    };
}

export function normalizePayrollSettlement(raw = {}) {
    const timestamp = raw.createdAt || raw.paidAt || new Date().toISOString();
    const normalizePayment = payment => {
        const currency = String(payment?.currency || 'USD').toUpperCase();
        return {
            methodId: String(payment?.methodId || payment?.metodoPago || ''),
            methodLabel: payment?.methodLabel || payment?.label || null,
            currency,
            amountUsd: round2(positiveNumber(payment?.amountUsd ?? (currency === 'USD' ? payment?.amount : 0))),
            amountBs: round2(positiveNumber(payment?.amountBs ?? (currency === 'BS' ? payment?.amount : 0))),
            amountCop: round2(positiveNumber(payment?.amountCop ?? (currency === 'COP' ? payment?.amount : 0))),
            isCash: payment?.isCash === true,
            reference: payment?.reference ? String(payment.reference).trim() : null,
        };
    };
    return {
        id: String(raw.id || crypto.randomUUID()),
        employeeId: String(raw.employeeId || ''),
        employeeNombre: String(raw.employeeNombre || ''),
        periodoId: String(raw.periodoId || ''),
        periodoInicio: raw.periodoInicio || null,
        periodoFin: raw.periodoFin || null,
        salarioSemanalUsd: round2(positiveNumber(raw.salarioSemanalUsd)),
        totalConsumosUsd: round2(positiveNumber(raw.totalConsumosUsd)),
        netoAPagarUsd: round2(positiveNumber(raw.netoAPagarUsd)),
        netoAPagarBs: round2(positiveNumber(raw.netoAPagarBs)),
        netoAPagarCop: round2(positiveNumber(raw.netoAPagarCop)),
        tasaBcv: round2(positiveNumber(raw.tasaBcv)),
        tasaCapturadaAt: raw.tasaCapturadaAt || timestamp,
        payments: (Array.isArray(raw.payments) ? raw.payments : []).map(normalizePayment),
        status: raw.status || SETTLEMENT_STATUS.PENDING,
        paidAt: raw.paidAt || null,
        consumptionIds: Array.isArray(raw.consumptionIds) ? raw.consumptionIds.map(String) : [],
        cashMovementId: raw.cashMovementId || null,
        cashReversalMovementId: raw.cashReversalMovementId || null,
        idempotencyKey: raw.idempotencyKey || null,
        nota: raw.nota ? String(raw.nota).trim() : '',
        actor: normalizeActor(raw.actor),
        deviceId: raw.deviceId || 'CAJA_PRINCIPAL',
        createdAt: raw.createdAt || timestamp,
        updatedAt: raw.updatedAt || timestamp,
        voidedAt: raw.voidedAt || null,
        voidedBy: raw.voidedBy ? normalizeActor(raw.voidedBy) : null,
        voidReason: raw.voidReason || null,
        recoveryError: raw.recoveryError || null,
    };
}
