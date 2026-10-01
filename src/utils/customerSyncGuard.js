/** Customer balance validation must quarantine questionable values, never repair them. */
export const MAX_CUSTOMER_FAVOR_THRESHOLD_USD = 300.00;
export const MAX_CUSTOMER_DEBT_THRESHOLD_USD = 2500.00;

function isCustomerRecord(customer) {
    return customer !== null && typeof customer === 'object' && !Array.isArray(customer)
        && ((typeof customer.id === 'string' && customer.id.trim() !== '')
            || (typeof customer.id === 'number' && Number.isFinite(customer.id)));
}

function isInvalidBalance(value, threshold, explicitlyConfirmed) {
    const isNumeric = typeof value === 'number'
        || (typeof value === 'string' && value.trim() !== '');
    const amount = isNumeric ? Number(value) : NaN;
    return !Number.isFinite(amount) || amount < 0 || (amount > threshold && !explicitlyConfirmed);
}

export function validateCustomerSyncPayload(customers) {
    const anomalies = [];
    const sanitized = Array.isArray(customers) ? Array.from(customers, (customer, index) => {
        if (!isCustomerRecord(customer)) {
            anomalies.push({ index, reason: 'Invalid customer record' });
            return customer && typeof customer === 'object' && !Array.isArray(customer)
                ? { ...customer, _quarantinedAnomaly: true } : customer;
        }

        const approval = customer.highAmountApproval;
        const explicitlyConfirmed = customer.isExplicitHighAmount === true && (!approval || (
            Number(approval.favor) === Number(customer.favor) && Number(approval.deuda) === Number(customer.deuda)
            && Number.isFinite(Date.parse(approval.approvedAt))
        ));
        const hasFavorAnomaly = isInvalidBalance(customer.favor, MAX_CUSTOMER_FAVOR_THRESHOLD_USD, explicitlyConfirmed);
        const hasDebtAnomaly = isInvalidBalance(customer.deuda, MAX_CUSTOMER_DEBT_THRESHOLD_USD, explicitlyConfirmed);

        if (hasFavorAnomaly || hasDebtAnomaly) {
            anomalies.push({
                index,
                id: customer.id,
                code: customer.code,
                name: customer.name,
                favor: customer.favor,
                deuda: customer.deuda,
                hasCorruptedFavor: hasFavorAnomaly,
                hasCorruptedDebt: hasDebtAnomaly,
                reason: hasFavorAnomaly ? 'Invalid or unconfirmed favor balance' : 'Invalid or unconfirmed debt balance'
            });
            return { ...customer, _quarantinedAnomaly: true };
        }
        if (customer._quarantinedAnomaly) {
            const confirmedCustomer = { ...customer };
            delete confirmedCustomer._quarantinedAnomaly;
            return confirmedCustomer;
        }
        return customer;
    }) : [];

    if (!Array.isArray(customers)) anomalies.push({ reason: 'Customer payload must be an array' });
    const valid = anomalies.length === 0;
    return {
        valid,
        isValid: valid,
        quarantined: !valid,
        // Compatibility aliases: these rows preserve balances and are NOT safe to push unless valid.
        sanitized,
        sanitizedCustomers: sanitized,
        anomalies,
        anomalousCustomers: anomalies
    };
}

/** Preserve unresolved local balances; use timestamps only for healthy conflicts. */
export function mergeCloudCustomers(cloudCustomers, localCustomers) {
    const localRows = validateCustomerSyncPayload(localCustomers).sanitized;
    if (!Array.isArray(cloudCustomers)) return localRows;
    const cloudRows = validateCustomerSyncPayload(cloudCustomers).sanitized;
    if (localRows.length === 0) return cloudRows;

    const localMap = new Map();
    for (const customer of localRows) {
        if (!isCustomerRecord(customer)) continue;
        localMap.set(customer.id, customer);
        if (customer.code) localMap.set(customer.code, customer);
    }

    const merged = cloudRows.map(cloudCustomer => {
        if (!isCustomerRecord(cloudCustomer)) return cloudCustomer;
        const localCustomer = localMap.get(cloudCustomer.id) || (cloudCustomer.code && localMap.get(cloudCustomer.code));
        if (!localCustomer) return cloudCustomer;

        // A cloud snapshot is not confirmation that the original local balance can be discarded.
        if (localCustomer._quarantinedAnomaly) return localCustomer;

        const cloudTs = cloudCustomer.updatedAt ? new Date(cloudCustomer.updatedAt).getTime() : 0;
        const localTs = localCustomer.updatedAt ? new Date(localCustomer.updatedAt).getTime() : 0;
        if (localTs > cloudTs && !isNaN(localTs) && (localTs - cloudTs) < 30 * 24 * 3600 * 1000) {
            return localCustomer;
        }
        return cloudCustomer;
    });

    const cloudIds = new Set(cloudRows.filter(isCustomerRecord).map(customer => customer.id));
    const cloudCodes = new Set(cloudRows.filter(isCustomerRecord).map(customer => customer.code).filter(Boolean));
    for (const localCustomer of localRows) {
        if (!isCustomerRecord(localCustomer)) {
            merged.push(localCustomer);
            continue;
        }
        const inCloud = cloudIds.has(localCustomer.id) || (localCustomer.code && cloudCodes.has(localCustomer.code));
        if (!inCloud) merged.push(localCustomer);
    }

    return merged;
}
