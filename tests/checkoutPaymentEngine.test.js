import { describe, expect, it } from 'vitest';
import { calculateChangeDistribution, calculatePaymentState, validatePaymentInput } from '../src/core/CheckoutPaymentEngine';

const rate = 46;

describe('CheckoutPaymentEngine', () => {
    it('uses manual Bs as the authority for pure Bs partial payments', () => {
        const state = calculatePaymentState({
            cartTotalUsd: 15,
            cartTotalBs: 13000,
            rate,
            payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountInput: 6500, amountBs: 6500 }],
            activeMethods: [{ id: 'efectivo_bs', currency: 'BS', isCash: true }],
        });

        expect(state.regime).toBe('PURE_BS');
        expect(state.remaining.bs).toBe(6500);
        expect(state.remaining.usd).toBe(7.5);
        expect(state.change.bs).toBe(0);
    });

    it('does not manufacture USD change for a pure Bs overpayment', () => {
        const state = calculatePaymentState({
            cartTotalUsd: 15,
            cartTotalBs: 13000,
            rate,
            payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountInput: 13050, amountBs: 13050 }],
            activeMethods: [{ id: 'efectivo_bs', currency: 'BS', isCash: true }],
        });

        expect(state.change.bs).toBe(50);
        expect(state.change.usd).toBe(0);
    });

    it('separates digital overpayment from physical cash received', () => {
        const state = calculatePaymentState({
            cartTotalUsd: 2,
            cartTotalBs: 92,
            rate,
            payments: [{ methodId: 'zelle', currency: 'USD', amountInput: 5, amountUsd: 5, amountBs: 230, isCash: false }],
            activeMethods: [{ id: 'zelle', currency: 'USD', isCash: false }],
        });

        expect(state.change.usd).toBe(3);
        expect(state.physicalCashReceived.usd).toBe(0);
    });

    it('rejects unsupported currencies and invalid amounts', () => {
        expect(validatePaymentInput({ methodId: 'x', currency: 'EUR', amountInput: 1 })).toEqual({
            valid: false,
            error: 'Moneda de pago inválida: EUR.',
        });
        expect(validatePaymentInput({ methodId: 'x', currency: 'USD', amountInput: -1 })).toEqual({
            valid: false,
            error: 'Monto inválido para x.',
        });
    });

    it('prevents physical change from exceeding the real change', () => {
        const result = calculateChangeDistribution({ changeUsd: 2, physicalUsd: 3, rate });
        expect(result.error).toBe('El vuelto físico excede el vuelto real.');
    });
});
