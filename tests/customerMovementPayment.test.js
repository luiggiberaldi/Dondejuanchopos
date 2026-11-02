import { describe, it, expect } from 'vitest';
import { Banknote, Smartphone, CreditCard, DollarSign, Wallet } from 'lucide-react';
import { getCustomerMovementPaymentInfo } from '../src/utils/monitorSaleFormat';

// ── Fixtures de cobros reales (sacados de Doc 60 de producción) ──

const cobroEfectivoBs = {
    tipo: 'COBRO_DEUDA',
    saleNumber: 1590,
    totalUsd: 4.36,
    totalBs: 4316,
    paymentMethod: 'efectivo_bs',
    payments: [{
        methodId: 'efectivo_bs',
        methodLabel: 'efectivo bs',
        amount: 4316,
        amountUsd: 4.36,
        amountBs: 4316,
        currency: 'BS'
    }],
    usuarioNombre: 'Luis Medina',
};

const cobroPagoMovil = {
    tipo: 'COBRO_DEUDA',
    totalUsd: 22.64,
    totalBs: 20000,
    paymentMethod: 'pago_movil',
    payments: [{
        methodId: 'pago_movil',
        methodLabel: 'pago movil',
        amount: 20000,
        amountUsd: 22.64,
        amountBs: 20000,
        currency: 'BS'
    }],
    usuarioNombre: 'Supervisor',
};

// BUG-1: punto_venta (id real en prod) ≠ punto_de_venta (antiguo alias en monitorSaleFormat)
const cobroPuntoVenta = {
    tipo: 'COBRO_DEUDA',
    saleNumber: 1293,
    totalUsd: 12.24,
    totalBs: 12000,
    paymentMethod: 'punto_venta',
    payments: [{
        methodId: 'punto_venta',
        methodLabel: 'punto venta',
        amount: 12000,
        amountUsd: 12.24,
        amountBs: 12000,
        currency: 'BS'
    }],
    usuarioNombre: 'Luis Medina',
};

// BUG-3: pagos en USD — amount != amountBs
const cobroEfectivoUsd = {
    tipo: 'COBRO_DEUDA',
    totalUsd: 5,
    totalBs: 4378.25,
    paymentMethod: 'efectivo_usd',
    payments: [{
        methodId: 'efectivo_usd',
        methodLabel: 'efectivo usd',
        amount: 5,
        amountUsd: 5,
        amountBs: 4378.25,
        currency: 'USD'
    }],
    usuarioNombre: 'Supervisor',
};

// Transferencia custom (método personalizado, tiene label en payments[])
const cobroTransferencia = {
    tipo: 'COBRO_DEUDA',
    totalUsd: 15.54,
    totalBs: 15000,
    paymentMethod: 'transferencia',
    payments: [{
        methodId: 'transferencia',
        methodLabel: 'Transferencia / Pago Directo al Dueño',
        amount: 15000,
        amountUsd: 15.54,
        amountBs: 15000,
        currency: 'BS'
    }],
    usuarioNombre: 'Supervisor',
};

// GAP-2: Cobro antiguo sin operador
const cobroSinOperador = {
    tipo: 'COBRO_DEUDA',
    saleNumber: 224,
    totalUsd: 25.4,
    totalBs: 22100,
    paymentMethod: 'pago_movil',
    payments: [{
        methodId: 'pago_movil',
        methodLabel: 'Pago Móvil',
        amount: 22100,
        amountUsd: 25.4,
        amountBs: 22100,
        currency: 'BS'
    }],
    // sin usuarioNombre ni actor
};

// GAP-5: Venta fiada — NO tiene pago, devuelve nulos
const ventaFiada = {
    tipo: 'VENTA_FIADA',
    saleNumber: 1599,
    totalUsd: 5,
    fiadoUsd: 5,
    items: [{ name: 'Combo 7 Cervezas', qty: 1, priceUsd: 5 }],
};

describe('getCustomerMovementPaymentInfo', () => {
    it('resuelve Efectivo Bs correctamente con ícono Banknote y formato Bs', () => {
        const r = getCustomerMovementPaymentInfo(cobroEfectivoBs);
        expect(r.isCobro).toBe(true);
        expect(r.isFiada).toBe(false);
        expect(r.methodId).toBe('efectivo_bs');
        expect(r.methodLabel).toMatch(/efectivo.*bs/i);
        expect(r.Icon).toBe(Banknote);
        expect(r.paymentSummaryLine).toContain('4.316');
        expect(r.paymentSummaryLine).toContain('Bs');
        expect(r.operatorName).toBe('Luis Medina');
        expect(r.badgeClass).toBeTruthy();
    });

    it('resuelve Pago Móvil con ícono Smartphone', () => {
        const r = getCustomerMovementPaymentInfo(cobroPagoMovil);
        expect(r.isCobro).toBe(true);
        expect(r.Icon).toBe(Smartphone);
        expect(r.methodLabel).toMatch(/pago m[oó]vil/i);
        expect(r.paymentSummaryLine).toContain('20.000');
    });

    // BUG-1: punto_venta debe tener CreditCard, no Wallet
    it('resuelve punto_venta con ícono CreditCard (alias añadido)', () => {
        const r = getCustomerMovementPaymentInfo(cobroPuntoVenta);
        expect(r.Icon).toBe(CreditCard);
        expect(r.Icon).not.toBe(Wallet);
        expect(r.methodLabel).toMatch(/punto.*venta/i);
        expect(r.paymentSummaryLine).toContain('12.000');
    });

    // BUG-3: USD — paymentSummaryLine usa dólares, no Bs
    it('resuelve Efectivo USD mostrando dólares en paymentSummaryLine', () => {
        const r = getCustomerMovementPaymentInfo(cobroEfectivoUsd);
        expect(r.Icon).toBe(DollarSign);
        expect(r.paymentSummaryLine).toContain('$5.00');
        expect(r.paymentSummaryLine).not.toContain('5,00 Bs');
    });

    it('resuelve transferencia custom preservando su methodLabel completo', () => {
        const r = getCustomerMovementPaymentInfo(cobroTransferencia);
        expect(r.methodLabel).toBe('Transferencia / Pago Directo al Dueño');
        expect(r.Icon).not.toBeNull();
        expect(r.paymentSummaryLine).toContain('15.000');
    });

    // GAP-2: operatorName null cuando no existe
    it('devuelve operatorName null cuando el cobro no tiene usuarioNombre ni actor', () => {
        const r = getCustomerMovementPaymentInfo(cobroSinOperador);
        expect(r.operatorName).toBeNull();
    });

    // GAP-5: VENTA_FIADA → todo nulo / isCobro false
    it('VENTA_FIADA: isCobro=false, methodId=null, no genera badge', () => {
        const r = getCustomerMovementPaymentInfo(ventaFiada);
        expect(r.isCobro).toBe(false);
        expect(r.isFiada).toBe(true);
        expect(r.methodId).toBeNull();
        expect(r.methodLabel).toBeNull();
        expect(r.Icon).toBeNull();
        expect(r.badgeClass).toBeNull();
        expect(r.paymentSummaryLine).toBeNull();
    });

    it('devuelve fallback seguro cuando no hay payments[] ni paymentMethod', () => {
        const r = getCustomerMovementPaymentInfo({ tipo: 'COBRO_DEUDA', totalUsd: 1 });
        expect(r.isCobro).toBe(true);
        expect(r.methodLabel).toBeTruthy();
        expect(r.paymentSummaryLine).toBeNull();
    });

    it('devuelve fallback seguro para sale null o undefined', () => {
        const r = getCustomerMovementPaymentInfo(null);
        expect(r.isCobro).toBe(false);
        expect(r.isFiada).toBe(false);
        expect(r.methodLabel).toBeNull();
    });
});
