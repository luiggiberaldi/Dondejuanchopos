import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    validateCustomerSyncPayload,
    mergeCloudCustomers,
    MAX_CUSTOMER_FAVOR_THRESHOLD_USD,
    MAX_CUSTOMER_DEBT_THRESHOLD_USD,
} from '../src/utils/customerSyncGuard';
import { processCustomerTransaction } from '../src/utils/customerTransactionProcessor';
import { storageService } from '../src/utils/storageService';

const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        async transaction(callback) {
            const { runLegacyUnitTransaction } = await import('./legacyUnitTransaction');
            return runLegacyUnitTransaction(this, callback);
        },
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
            return value;
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/utils/saleNumberAllocator', () => ({
    allocateSaleNumber: vi.fn(async () => ({ saleNumber: 'LOCAL-TEST-1', provisional: true })),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: {
        getState: () => ({
            usuarioActivo: { id: 'admin-user', nombre: 'Admin', rol: 'ADMIN' },
        }),
    },
}));

describe('customerSyncGuard: Payload Validation and Quarantine', () => {
    it('passes healthy customers unchanged', () => {
        const customers = [
            { id: 'c1', name: 'Normal 1', deuda: 10.50, favor: 0 },
            { id: 'c2', name: 'Normal 2', deuda: 0, favor: 25.00 },
            { id: 'c3', name: 'Normal 3', deuda: 0, favor: 0 },
        ];

        const result = validateCustomerSyncPayload(customers);
        expect(result.isValid).toBe(true);
        expect(result.anomalousCustomers).toHaveLength(0);
        expect(result.sanitizedCustomers).toEqual(customers);
    });

    it('quarantines anomalous favor (> $300) without changing its amount', () => {
        const customers = [
            { id: 'c1', name: 'Jose Gregorio (Mono)', deuda: 14.08, favor: 2022.97 },
            { id: 'c2', name: 'Cliente Normal', deuda: 5.00, favor: 0 },
        ];

        const result = validateCustomerSyncPayload(customers);
        expect(result.isValid).toBe(false);
        expect(result.anomalousCustomers).toHaveLength(1);
        expect(result.anomalousCustomers[0].id).toBe('c1');
        expect(result.anomalousCustomers[0].hasCorruptedFavor).toBe(true);

        const sanitizedC1 = result.sanitizedCustomers.find(c => c.id === 'c1');
        expect(sanitizedC1.favor).toBe(2022.97);
        expect(sanitizedC1.deuda).toBe(14.08);
        expect(sanitizedC1._quarantinedAnomaly).toBe(true);
        expect(result.quarantined).toBe(true);
        expect(customers[0]).not.toHaveProperty('_quarantinedAnomaly');
        expect(customers[0].favor).toBe(2022.97);

        const sanitizedC2 = result.sanitizedCustomers.find(c => c.id === 'c2');
        expect(sanitizedC2.favor).toBe(0);
        expect(sanitizedC2.deuda).toBe(5.00);
    });

    it('detects excessive debt (> $2500)', () => {
        const customers = [
            { id: 'c-whale', name: 'Deuda Gigante', deuda: 3500.00, favor: 0 },
        ];

        const result = validateCustomerSyncPayload(customers);
        expect(result.isValid).toBe(false);
        expect(result.anomalousCustomers).toHaveLength(1);
        expect(result.anomalousCustomers[0].hasCorruptedDebt).toBe(true);
    });

    it.each([null, undefined, {}, 'not-an-array', 42])('rejects non-array input %s', payload => {
        const result = validateCustomerSyncPayload(payload);
        expect(result.valid).toBe(false);
        expect(result.isValid).toBe(false);
        expect(result.quarantined).toBe(true);
        expect(result.sanitizedCustomers).toEqual([]);
        expect(result.anomalies).toHaveLength(1);
        expect(result.sanitizedCustomers).toBe(result.sanitized);
        expect(result.anomalousCustomers).toBe(result.anomalies);
    });

    it.each([
        [0, 0, true],
        [299.99, 2499.99, true],
        [300, 2500, true],
        [300.01, 2500, false],
        [300, 2500.01, false],
        [1000, 0, false],
    ])('preserves boundary amounts favor=%s deuda=%s (valid=%s)', (favor, deuda, valid) => {
        expect(MAX_CUSTOMER_FAVOR_THRESHOLD_USD).toBe(300);
        expect(MAX_CUSTOMER_DEBT_THRESHOLD_USD).toBe(2500);
        const customer = Object.freeze({ id: 'boundary', favor, deuda });
        const result = validateCustomerSyncPayload(Object.freeze([customer]));
        expect(result.valid).toBe(valid);
        expect(result.isValid).toBe(valid);
        expect(result.quarantined).toBe(!valid);
        expect(result.sanitized[0]).toMatchObject(customer);
        expect(result.sanitized).toBe(result.sanitizedCustomers);
        expect(result.anomalies).toBe(result.anomalousCustomers);
    });

    it.each([true, false, undefined, 'true', 1])('only boolean true confirms high amounts: %s', confirmation => {
        const customer = Object.freeze({
            id: 'confirmed', favor: 301, deuda: 2501, isExplicitHighAmount: confirmation,
        });
        const result = validateCustomerSyncPayload([customer]);
        expect(result.valid).toBe(confirmation === true);
        expect(result.sanitized[0]).toMatchObject(customer);
        if (confirmation === true) expect(result.sanitized[0]).toBe(customer);
    });

    describe.each(['favor', 'deuda'])('invalid %s values', field => {
        it.each([NaN, Infinity, -Infinity, -0.01, 'NaN', 'Infinity', '-1', 'not-a-number', '', ' ', null, undefined, true, [], {}])(
            'quarantines %s even when explicitly confirmed, without coercing it', amount => {
                const customer = Object.freeze({ id: 'invalid-amount', favor: 0, deuda: 0, [field]: amount, isExplicitHighAmount: true });
                const result = validateCustomerSyncPayload([customer]);
                expect(result.valid).toBe(false);
                expect(result.quarantined).toBe(true);
                expect(result.sanitized[0][field]).toBe(amount);
                expect(result.anomalies[0][field]).toBe(amount);
                expect(result.sanitized[0]._quarantinedAnomaly).toBe(true);
                expect(customer).not.toHaveProperty('_quarantinedAnomaly');
            }
        );
    });

    it.each([null, undefined, 'invalid', 42, false, [], {}, { favor: 301, deuda: 0, isExplicitHighAmount: true }, { id: '', favor: 0, deuda: 0 }])(
        'quarantines malformed customer rows without dropping them: %s', customer => {
            const result = validateCustomerSyncPayload([customer]);
            expect(result.valid).toBe(false);
            expect(result.sanitized).toHaveLength(1);
            expect(result.anomalies).toHaveLength(1);
            expect(result.anomalies[0].index).toBe(0);
            if (customer && typeof customer === 'object' && !Array.isArray(customer)) {
                expect(result.sanitized[0]).toEqual({ ...customer, _quarantinedAnomaly: true });
            } else {
                expect(result.sanitized[0]).toBe(customer);
            }
        }
    );

    it('does not silently accept sparse rows or synthesize missing amounts', () => {
        expect(validateCustomerSyncPayload(new Array(1)).valid).toBe(false);
        const customer = { id: 'missing-balances', isExplicitHighAmount: true };
        const result = validateCustomerSyncPayload([customer]);
        expect(result.valid).toBe(false);
        expect(result.sanitized[0]).not.toHaveProperty('favor');
        expect(result.sanitized[0]).not.toHaveProperty('deuda');
    });

    it.each([false, true])('preserves numeric strings byte-for-byte with confirmation=%s', isExplicitHighAmount => {
        const customers = [
            Object.freeze({ id: 'healthy-strings', favor: '025.00', deuda: '010.50' }),
            Object.freeze({ id: 'high-strings', favor: '0301.00', deuda: '02501.00', isExplicitHighAmount }),
        ];
        const result = validateCustomerSyncPayload(Object.freeze(customers));
        expect(result.valid).toBe(isExplicitHighAmount);
        result.sanitized.forEach((customer, index) => {
            expect(customer.favor).toBe(customers[index].favor);
            expect(customer.deuda).toBe(customers[index].deuda);
        });
    });

    it('clears stale quarantine metadata only after the amounts become valid', () => {
        const customer = Object.freeze({ id: 'resolved', favor: 301, deuda: 2501, _quarantinedAnomaly: true });
        expect(validateCustomerSyncPayload([customer]).valid).toBe(false);
        const result = validateCustomerSyncPayload([{ ...customer, isExplicitHighAmount: true }]);
        expect(result.valid).toBe(true);
        expect(result.quarantined).toBe(false);
        expect(result.sanitized[0]).not.toHaveProperty('_quarantinedAnomaly');
        expect(result.sanitized[0].favor).toBe(301);
        expect(customer._quarantinedAnomaly).toBe(true);
    });
});

describe('customerSyncGuard: Smart Cloud Customer Merging', () => {
    it('prefers cloud customer when cloud updatedAt is newer', () => {
        const localCustomers = [
            {
                id: 'CLI-00011',
                name: 'mono',
                deuda: 10.71,
                favor: 0,
                updatedAt: '2026-09-10T10:00:00.000Z',
            },
        ];
        const cloudCustomers = [
            {
                id: 'CLI-00011',
                name: 'jose gregorio',
                deuda: 14.08,
                favor: 0,
                updatedAt: '2026-09-11T14:40:00.000Z',
            },
        ];

        const merged = mergeCloudCustomers(cloudCustomers, localCustomers);
        expect(merged).toHaveLength(1);
        expect(merged[0].name).toBe('jose gregorio');
        expect(merged[0].deuda).toBe(14.08);
    });

    it('prefers local customer when local updatedAt is newer and balance is healthy', () => {
        const localCustomers = [
            {
                id: 'CLI-00011',
                name: 'jose gregorio',
                deuda: 14.08,
                favor: 0,
                updatedAt: '2026-09-11T16:00:00.000Z',
            },
        ];
        const cloudCustomers = [
            {
                id: 'CLI-00011',
                name: 'jose gregorio',
                deuda: 10.71,
                favor: 0,
                updatedAt: '2026-09-11T14:40:00.000Z',
            },
        ];

        const merged = mergeCloudCustomers(cloudCustomers, localCustomers);
        expect(merged[0].deuda).toBe(14.08);
    });

    it('overrides local customer if local has corrupted favor balance (> $300) even with newer timestamp', () => {
        const localCustomers = [
            {
                id: 'CLI-00011',
                name: 'mono',
                deuda: 10.71,
                favor: 2022.97, // Corrupted local balance!
                updatedAt: '2026-09-11T18:00:00.000Z',
            },
        ];
        const cloudCustomers = [
            {
                id: 'CLI-00011',
                name: 'jose gregorio',
                deuda: 14.08,
                favor: 0, // Healthy cloud fix
                updatedAt: '2026-09-11T14:40:00.000Z',
            },
        ];

        const merged = mergeCloudCustomers(cloudCustomers, localCustomers);
        expect(merged[0].favor).toBe(2022.97);
        expect(merged[0].deuda).toBe(10.71);
        expect(merged[0].name).toBe('mono');
        expect(merged[0]._quarantinedAnomaly).toBe(true);
        expect(validateCustomerSyncPayload(merged).valid).toBe(false);
        expect(localCustomers[0]).not.toHaveProperty('_quarantinedAnomaly');
        expect(cloudCustomers[0].favor).toBe(0);
    });

    it('preserves local-only customers and adds cloud-only customers', () => {
        const localCustomers = [
            { id: 'local-only', name: 'Local Only', deuda: 2.0, favor: 0 },
        ];
        const cloudCustomers = [
            { id: 'cloud-only', name: 'Cloud Only', deuda: 3.0, favor: 0 },
        ];

        const merged = mergeCloudCustomers(cloudCustomers, localCustomers);
        expect(merged).toHaveLength(2);
        expect(merged.find(c => c.id === 'local-only')).toBeDefined();
        expect(merged.find(c => c.id === 'cloud-only')).toBeDefined();
    });
});

describe('customerSyncGuard: Non-destructive merge quarantine', () => {
    it.each([true, false])('retains local-only high balances with explicit confirmation=%s', isExplicitHighAmount => {
        const customer = Object.freeze({ id: 'local-high', favor: 1000, deuda: 3000, isExplicitHighAmount });
        const merged = mergeCloudCustomers([], Object.freeze([customer]));
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject(customer);
        expect(validateCustomerSyncPayload(merged).valid).toBe(isExplicitHighAmount);
        expect(Boolean(merged[0]._quarantinedAnomaly)).toBe(!isExplicitHighAmount);
    });

    it.each([
        { favor: 301, deuda: 50 },
        { favor: 50, deuda: 2501 },
        { favor: NaN, deuda: 50, isExplicitHighAmount: true },
        { favor: 50, deuda: Infinity, isExplicitHighAmount: true },
        { favor: -1, deuda: 50, isExplicitHighAmount: true },
    ])('retains unresolved local amounts even against a newer cloud snapshot: %s', balances => {
        const local = Object.freeze({ id: 'local-id', code: 'same-code', ...balances, updatedAt: '2026-09-10T12:00:00Z' });
        const cloud = Object.freeze({ id: 'cloud-id', code: 'same-code', favor: 0, deuda: 0, updatedAt: '2026-09-11T12:00:00Z' });
        const merged = mergeCloudCustomers(Object.freeze([cloud]), Object.freeze([local]));
        expect(merged).toHaveLength(1);
        expect(merged[0]).toEqual({ ...local, _quarantinedAnomaly: true });
        expect(validateCustomerSyncPayload(merged).valid).toBe(false);
        expect(cloud.favor).toBe(0);
        expect(local).not.toHaveProperty('_quarantinedAnomaly');
    });

    it('preserves a newer explicitly confirmed high local customer under timestamp merge rules', () => {
        const local = { id: 'same', favor: 1000, deuda: 3000, isExplicitHighAmount: true, updatedAt: '2026-09-11T12:00:00Z' };
        const cloud = { id: 'same', favor: 0, deuda: 0, updatedAt: '2026-09-10T12:00:00Z' };
        expect(mergeCloudCustomers([cloud], [local])).toEqual([local]);
    });

    it.each([[], null, undefined])('keeps local-only quarantine when cloud data is %s', cloud => {
        const local = { id: 'local', favor: '0301.00', deuda: 100 };
        const merged = mergeCloudCustomers(cloud, [local]);
        expect(merged).toEqual([{ ...local, _quarantinedAnomaly: true }]);
        expect(validateCustomerSyncPayload(merged).valid).toBe(false);
    });

    it('quarantines cloud-only anomalies without rewriting their original amounts', () => {
        const cloud = { id: 'cloud', favor: Infinity, deuda: 3000, isExplicitHighAmount: true };
        const merged = mergeCloudCustomers([cloud], []);
        expect(merged).toEqual([{ ...cloud, _quarantinedAnomaly: true }]);
        expect(validateCustomerSyncPayload(merged).valid).toBe(false);
    });

    it('keeps malformed rows visible to validation instead of dropping them during merge', () => {
        const local = [null, { favor: 1234, deuda: 99, isExplicitHighAmount: true }];
        const cloud = [{ id: 'healthy', favor: 0, deuda: 0 }, null];
        const merged = mergeCloudCustomers(cloud, local);
        expect(merged).toHaveLength(4);
        expect(merged[2]).toBeNull();
        expect(merged[3]).toMatchObject(local[1]);
        expect(validateCustomerSyncPayload(merged).anomalies).toHaveLength(3);
    });
});

describe('customerTransactionProcessor: Commercial Sanity Limits', () => {
    beforeEach(() => {
        _memoryStore.clear();
        storageService.getItem.mockClear();
        storageService.setItem.mockClear();
    });

    it.each([999.99, 1000])('allows an unconfirmed transaction at or below the $1,000 boundary: %s', transactionAmount => {
        const customer = { id: 'boundary-customer', name: 'Boundary', deuda: 2000, favor: 0 };
        return processCustomerTransaction({
            transactionAmount, currencyMode: 'USD', type: 'ABONO', customer,
            paymentMethod: 'efectivo_usd', bcvRate: 580,
        }).then(result => {
            expect(result.error).toBeUndefined();
            expect(result.updatedCustomer.deuda).toBe(2000 - transactionAmount);
        });
    });

    it('blocks a transaction one cent above $1,000 without writing balances', async () => {
        const customer = { id: 'boundary-customer', name: 'Boundary', deuda: 2000, favor: 0 };
        const result = await processCustomerTransaction({
            transactionAmount: 1000.01, currencyMode: 'USD', type: 'ABONO', customer,
            paymentMethod: 'efectivo_usd', bcvRate: 580,
        });
        expect(result.error).toContain('$1,000 USD');
        expect(storageService.setItem).not.toHaveBeenCalled();
        expect(customer.deuda).toBe(2000);
    });

    it('blocks transactions over $1,000 USD when not explicitly confirmed', async () => {
        const customer = { id: 'cust-1', name: 'Test', deuda: 2000, favor: 0 };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const result = await processCustomerTransaction({
            transactionAmount: 1500,
            currencyMode: 'USD',
            type: 'ABONO',
            customer,
            paymentMethod: 'efectivo_usd',
            bcvRate: 580,
            isExplicitHighAmount: false,
        });

        expect(result.error).toBeDefined();
        expect(result.error).toContain('El monto excede el límite de seguridad ($1,000 USD)');
    });

    it('allows transactions over $1,000 USD when isExplicitHighAmount is true', async () => {
        const customer = { id: 'cust-1', name: 'Test', deuda: 2000, favor: 0 };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const result = await processCustomerTransaction({
            transactionAmount: 1500,
            currencyMode: 'USD',
            type: 'ABONO',
            customer,
            paymentMethod: 'efectivo_usd',
            bcvRate: 580,
            isExplicitHighAmount: true,
        });

        expect(result.error).toBeUndefined();
        expect(result.updatedCustomer.deuda).toBe(500);
        expect(result.updatedCustomer.updatedAt).toBeDefined();
    });

    it('sets fresh updatedAt on updated customer after transaction', async () => {
        const customer = { id: 'cust-2', name: 'Pedro', deuda: 20, favor: 0 };
        await storageService.setItem('bodega_customers_v1', [customer]);

        const beforeTime = new Date().toISOString();
        const result = await processCustomerTransaction({
            transactionAmount: 10,
            currencyMode: 'USD',
            type: 'ABONO',
            customer,
            paymentMethod: 'efectivo_usd',
            bcvRate: 580,
        });

        expect(result.error).toBeUndefined();
        expect(result.updatedCustomer.updatedAt).toBeDefined();
        expect(new Date(result.updatedCustomer.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(beforeTime).getTime());
    });
});
