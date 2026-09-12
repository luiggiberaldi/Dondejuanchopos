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

    it('sanitizes anomalous favor balance (> $300) to $0', () => {
        const customers = [
            { id: 'c1', name: 'Jose Gregorio (Mono)', deuda: 14.08, favor: 2022.97 },
            { id: 'c2', name: 'Cliente Normal', deuda: 5.00, favor: 0 },
        ];

        const result = validateCustomerSyncPayload(customers);
        expect(result.isValid).toBe(false);
        expect(result.anomalousCustomers).toHaveLength(1);
        expect(result.anomalousCustomers[0].id).toBe('c1');
        expect(result.anomalousCustomers[0].hasCorruptedFavor).toBe(true);

        // Sanitized result resets c1 favor to 0, preserves healthy c2
        const sanitizedC1 = result.sanitizedCustomers.find(c => c.id === 'c1');
        expect(sanitizedC1.favor).toBe(0);
        expect(sanitizedC1.deuda).toBe(14.08);

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

    it('handles non-array input safely', () => {
        const result = validateCustomerSyncPayload(null);
        expect(result.isValid).toBe(false);
        expect(result.sanitizedCustomers).toEqual([]);
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
        expect(merged[0].favor).toBe(0);
        expect(merged[0].name).toBe('jose gregorio');
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

describe('customerTransactionProcessor: Commercial Sanity Limits', () => {
    beforeEach(() => {
        _memoryStore.clear();
        storageService.getItem.mockClear();
        storageService.setItem.mockClear();
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
