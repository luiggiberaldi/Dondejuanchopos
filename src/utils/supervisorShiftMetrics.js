const emptyTotals = () => ({
    totalUsd: 0,
    totalBs: 0,
    totalCop: 0,
    count: 0,
});

function amount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.abs(number) : 0;
}

function addMovementTotals(target, movement) {
    target.totalUsd += amount(movement.totalUsd);
    target.totalBs += amount(movement.totalBs);
    target.totalCop += amount(movement.totalCop);
    target.count += 1;
}

/**
 * Resume the two kinds of cash outflow shown at the top of the Supervisor dashboard.
 * GASTO_INTERNO and PAGO_PROVEEDOR stay separate so the operator can distinguish
 * operating expenses from supplier payments.
 */
export function calculateSupervisorOutflowMetrics(movements = []) {
    const expenses = emptyTotals();
    const supplierPayments = emptyTotals();

    for (const movement of Array.isArray(movements) ? movements : []) {
        if (!movement || movement.status === 'ANULADA') continue;
        if (movement.tipo === 'GASTO_INTERNO') addMovementTotals(expenses, movement);
        if (movement.tipo === 'PAGO_PROVEEDOR') addMovementTotals(supplierPayments, movement);
    }

    return { expenses, supplierPayments };
}

/**
 * Aggregate physical change returned to customers. A resolver is injected by the
 * view so legacy sales can use the same normalization already used in sale details.
 */
export function calculateSupervisorChangeMetrics(movements = [], resolveChange = (movement) => ({
    changeUsd: movement?.changeUsd || movement?.changeGiven?.usd || 0,
    changeBs: movement?.changeBs || movement?.changeGiven?.bs || 0,
})) {
    const result = emptyTotals();

    for (const movement of Array.isArray(movements) ? movements : []) {
        if (!movement || movement.status === 'ANULADA') continue;
        const change = resolveChange(movement) || {};
        const changeUsd = amount(change.changeUsd);
        const changeBs = amount(change.changeBs);
        const changeCop = amount(change.changeCop);
        if (changeUsd <= 0 && changeBs <= 0 && changeCop <= 0) continue;

        result.totalUsd += changeUsd;
        result.totalBs += changeBs;
        result.totalCop += changeCop;
        result.count += 1;
    }

    return result;
}

export default {
    calculateSupervisorOutflowMetrics,
    calculateSupervisorChangeMetrics,
};
