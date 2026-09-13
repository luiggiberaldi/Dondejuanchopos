import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Invariantes de cableado para FASE 3B (saleNumberAllocator), siguiendo el
 * patrón fuente-invariante del repo (cf. salesHistoryRestoreWiring.test.js).
 */
const CHECKOUT = readFileSync(join(__dirname, '..', 'src', 'utils', 'checkoutProcessor.js'), 'utf8');
const CUSTOMERS = readFileSync(join(__dirname, '..', 'src', 'utils', 'customerTransactionProcessor.js'), 'utf8');
const ALLOCATOR = readFileSync(join(__dirname, '..', 'src', 'utils', 'saleNumberAllocator.js'), 'utf8');
const HOOK = readFileSync(join(__dirname, '..', 'src', 'hooks', 'useSupervisorCommands.js'), 'utf8');

describe('checkoutProcessor — facturación usa numeración central', () => {
    test('importa y llama allocateSaleNumber con el deviceId real', () => {
        expect(CHECKOUT).toContain("from './saleNumberAllocator'");
        expect(CHECKOUT).toContain('allocateSaleNumber(deviceId, { localSales: existingSales })');
    });
    test('ya NO numeración max(local)+1 en el sitio de facturación', () => {
        expect(CHECKOUT.includes('existingSales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1')).toBe(false);
    });
    test('persiste el marcador provisional cuando el allocation fue fallback', () => {
        expect(CHECKOUT).toContain('saleNumberProvisional: true');
        expect(CHECKOUT).toContain('saleNumberNote: allocation.note');
    });
    test('la asignación ocurre DENTRO del pos_write_lock', () => {
        const lockIdx = CHECKOUT.indexOf("withLock('pos_write_lock'");
        const allocIdx = CHECKOUT.indexOf('allocateSaleNumber(deviceId');
        expect(lockIdx).toBeGreaterThan(-1);
        expect(allocIdx).toBeGreaterThan(lockIdx);
    });
});

describe('customerTransactionProcessor — abonos/créditos usan numeración central', () => {
    test('importa y llama allocateSaleNumber con el deviceId real', () => {
        expect(CUSTOMERS).toContain("from './saleNumberAllocator'");
        expect(CUSTOMERS).toContain('allocateSaleNumber(deviceId, { localSales: sales })');
    });
    test('ya NO numeración max(local)+1', () => {
        expect(CUSTOMERS.includes("sales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1")).toBe(false);
    });
    test('ambos registros (COBRO_DEUDA y VENTA_FIADA) marcables como provisionales', () => {
        expect((CUSTOMERS.match(/saleNumberProvisional: true/g) || []).length).toBe(2);
    });
    test('la asignación ocurre DENTRO del pos_write_lock', () => {
        const lockIdx = CUSTOMERS.indexOf("withLock('pos_write_lock'");
        const allocIdx = CUSTOMERS.indexOf('allocateSaleNumber(deviceId');
        expect(lockIdx).toBeGreaterThan(-1);
        expect(allocIdx).toBeGreaterThan(lockIdx);
    });
});

describe('saleNumberAllocator — invariantes de seguridad', () => {
    test('el reclamo se inserta como pending (exigido por RLS) y SE AUTOCONFIRMA con update a applied', () => {
        expect(ALLOCATOR).toContain("action: CLAIM_ACTION");
        expect(ALLOCATOR).toContain("status: 'pending'");
        expect(ALLOCATOR).toMatch(/\.update\(\{ status: 'applied' \}\)/);
    });
    test('la relectura de reclamos es AGNÓSTICA de status (pending y applied cuentan)', () => {
        expect(ALLOCATOR).toContain(".in('status', ['pending', 'applied'])");
        expect(ALLOCATOR).not.toMatch(/\.eq\('status', 'applied'\)/);
    });
    test('el fallback nunca devuelve un número por debajo del máximo local', () => {
        expect(ALLOCATOR).toContain('const fallback = localMax + 1;');
    });
    test('presupuesto de tiempo acotado (no bloquea el checkout sin nube)', () => {
        expect(ALLOCATOR).toContain('ALLOC_TIMEOUT_MS = 4000');
    });
    test('el hook NUNCA procesa sale_number_claim como comando (enrutamiento excluido)', () => {
        expect(HOOK).toContain("command.payload?.action !== 'sale_number_claim'");
    });
});
