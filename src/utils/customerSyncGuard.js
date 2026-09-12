/**
 * Guardarraíles de integridad y sincronización para Clientes (bodega_customers_v1).
 * Previene que anomalías de saldo (ej. >  favor) se propaguen a la nube
 * y garantiza una fusión inteligente basada en timestamps (updatedAt) en lugar de sobreescritura ciega.
 */

export const MAX_CUSTOMER_FAVOR_THRESHOLD_USD = 300.00;
export const MAX_CUSTOMER_DEBT_THRESHOLD_USD = 2500.00;

/**
 * Valida un array de clientes antes del push a Supabase.
 * Detecta valores atípicos imposibles en un negocio de abasto de barrio.
 */
export function validateCustomerSyncPayload(customers) {
    if (!Array.isArray(customers)) {
        return {
            valid: false,
            isValid: false,
            sanitized: [],
            sanitizedCustomers: [],
            anomalies: [],
            anomalousCustomers: []
        };
    }

    const anomalies = [];
    const sanitized = customers.map(c => {
        if (!c) return c;
        const favor = Number(c.favor) || 0;
        const deuda = Number(c.deuda) || 0;

        // Si excede el tope de favor o deuda y no fue explícitamente confirmado
        const hasFavorAnomaly = favor > MAX_CUSTOMER_FAVOR_THRESHOLD_USD && !c.isExplicitHighAmount;
        const hasDebtAnomaly = deuda > MAX_CUSTOMER_DEBT_THRESHOLD_USD && !c.isExplicitHighAmount;

        if (hasFavorAnomaly || hasDebtAnomaly) {
            anomalies.push({
                id: c.id,
                code: c.code,
                name: c.name,
                favor,
                deuda,
                hasCorruptedFavor: hasFavorAnomaly,
                hasCorruptedDebt: hasDebtAnomaly,
                reason: hasFavorAnomaly ? `Saldo a favor anómalo: $${favor}` : `Deuda anómala: $${deuda}`
            });
            // Sanitización quirúrgica: aislar el saldo anómalo para no contaminar la nube
            return {
                ...c,
                favor: hasFavorAnomaly ? 0 : favor,
                _quarantinedAnomaly: true
            };
        }
        return c;
    });

    const isHealthy = anomalies.length === 0;
    return {
        valid: isHealthy,
        isValid: isHealthy,
        sanitized,
        sanitizedCustomers: sanitized,
        anomalies,
        anomalousCustomers: anomalies
    };
}

/**
 * Fusión inteligente de clientes (Cloud vs Local).
 * Resuelve conflictos cliente a cliente basándose en el timestamp más reciente (updatedAt).
 */
export function mergeCloudCustomers(cloudCustomers, localCustomers) {
    if (!Array.isArray(cloudCustomers)) return localCustomers || [];
    if (!Array.isArray(localCustomers) || localCustomers.length === 0) return cloudCustomers;

    const localMap = new Map();
    for (const c of localCustomers) {
        if (c?.id) localMap.set(c.id, c);
        if (c?.code) localMap.set(c.code, c);
    }

    const merged = cloudCustomers.map(cloudC => {
        if (!cloudC?.id) return cloudC;
        const localC = localMap.get(cloudC.id) || (cloudC.code && localMap.get(cloudC.code));
        if (!localC) return cloudC;

        const cloudTs = cloudC.updatedAt ? new Date(cloudC.updatedAt).getTime() : 0;
        const localTs = localC.updatedAt ? new Date(localC.updatedAt).getTime() : 0;

        // Si la versión local tiene una anomalía de saldo a favor (> ), la nube siempre gana
        const localFavor = Number(localC.favor) || 0;
        if (localFavor > MAX_CUSTOMER_FAVOR_THRESHOLD_USD && !localC.isExplicitHighAmount) {
            return cloudC;
        }

        // Si la versión local es estrictamente más reciente y válida
        if (localTs > cloudTs && !isNaN(localTs) && (localTs - cloudTs) < 30 * 24 * 3600 * 1000) {
            return localC;
        }

        // Por defecto, la versión de la nube
        return cloudC;
    });

    // Añadir clientes creados recientemente en local estando offline
    const cloudIds = new Set(cloudCustomers.map(c => c.id).filter(Boolean));
    const cloudCodes = new Set(cloudCustomers.map(c => c.code).filter(Boolean));

    for (const localC of localCustomers) {
        if (!localC?.id) continue;
        const inCloud = cloudIds.has(localC.id) || (localC.code && cloudCodes.has(localC.code));
        if (!inCloud) {
            const favor = Number(localC.favor) || 0;
            if (favor <= MAX_CUSTOMER_FAVOR_THRESHOLD_USD) {
                merged.push(localC);
            }
        }
    }

    return merged;
}
