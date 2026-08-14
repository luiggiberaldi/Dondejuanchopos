import { describe, expect, it } from 'vitest';
import { assertCheckoutInvariants, calculateChangeAllocation, calculateChangeDistribution, calculateChangeInputUpdate, calculatePaymentState, validateChangeOwed, validatePaymentInput } from '../src/core/CheckoutPaymentEngine';
import { mulR } from '../src/utils/dinero';

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

    it('reproduce el vuelto de la captura sin doble redondeo', () => {
        const state = calculatePaymentState({
            cartTotalUsd: 15.56,
            cartTotalBs: 12000,
            rate: 771.07,
            payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountInput: 20 }],
            activeMethods: [{ id: 'efectivo_usd', currency: 'USD', isCash: true }],
        });

        expect(state.regime).toBe('USD');
        expect(state.change.usd).toBe(4.44);
        expect(state.change.totalUsd).toBe(4.44);
        expect(state.change.totalBs).toBe(3423.55);
        expect(state.change.authority).toBe('USD');
        expect(state.change.totalBs).toBe(mulR(4.44, 771.07));
    });

    it('conserva el vuelto puro en Bs como Bs y no lo vuelve a redondear desde USD', () => {
        const state = calculatePaymentState({
            cartTotalUsd: 15.56,
            cartTotalBs: 12000,
            rate: 771.07,
            payments: [{ methodId: 'efectivo_bs', currency: 'BS', amountInput: 12050 }],
            activeMethods: [{ id: 'efectivo_bs', currency: 'BS', isCash: true }],
        });

        expect(state.regime).toBe('PURE_BS');
        expect(state.change.bs).toBe(50);
        expect(state.change.totalBs).toBe(50);
        expect(calculateChangeAllocation({
            totalChangeBs: state.change.totalBs,
            physicalBs: state.change.bs,
            rate: 771.07,
        }).remainingBs).toBe(0);
    });

    it('permite repartir un solo vuelto entre USD y Bs sin excederlo', () => {
        const allocation = calculateChangeAllocation({
            totalChangeUsd: 4.44,
            totalChangeBs: 3423.55,
            physicalUsd: 2,
            physicalBs: 1881.41,
            rate: 771.07,
        });

        expect(allocation.distributedBs).toBe(3423.55);
        expect(allocation.remainingBs).toBe(0);
        expect(allocation.remainingUsd).toBe(0);
    });

    it('permite $4 + Bs 500 sin recalcular silenciosamente los dólares a $4.99', () => {
        const update = calculateChangeInputUpdate({
            currency: 'bs',
            requestedValue: '500',
            currentUsd: '4',
            currentBs: '',
            totalChangeBs: 3855.35,
            rate: 771.07,
        });

        expect(update).toMatchObject({ usd: 4, bs: 500, wasClamped: false });
    });

    it('limita solo el campo que excede y conserva el otro componente', () => {
        const bsUpdate = calculateChangeInputUpdate({
            currency: 'bs',
            requestedValue: '5000',
            currentUsd: '4',
            totalChangeBs: 3855.35,
            rate: 771.07,
        });
        expect(bsUpdate.usd).toBe(4);
        expect(bsUpdate.bs).toBe(771.07);
        expect(bsUpdate.wasClamped).toBe(true);

        const usdUpdate = calculateChangeInputUpdate({
            currency: 'usd',
            requestedValue: '5',
            currentUsd: '4',
            currentBs: '500',
            totalChangeBs: 3855.35,
            rate: 771.07,
        });
        expect(usdUpdate.usd).toBe(4.35);
        expect(usdUpdate.bs).toBe(500);
        expect(usdUpdate.wasClamped).toBe(true);
    });

    it('mantiene $4 mientras se escribe Bs 500 dígito por dígito', () => {
        let currentBs = '';
        for (const requestedValue of ['5', '50', '500']) {
            const update = calculateChangeInputUpdate({
                currency: 'bs',
                requestedValue,
                currentUsd: '4',
                currentBs,
                totalChangeBs: 3855.35,
                rate: 771.07,
            });

            expect(update.usd).toBe(4);
            expect(update.wasClamped).toBe(false);
            currentBs = update.bs.toString();
        }

        expect(currentBs).toBe('500');
    });

    it('valida método y completa el vuelto por fuera en la moneda autoridad', () => {
        expect(validateChangeOwed({ amountUsd: 2, amountBs: 80, method: 'pago_movil' })).toMatchObject({
            valid: true,
            amountUsd: 2,
            amountBs: 80,
            method: 'pago_movil',
        });
        expect(validateChangeOwed({ amountUsd: 2, amountBs: 80, method: 'bitcoin' }).valid).toBe(false);
        expect(validateChangeOwed({ amountUsd: 2, amountBs: 79, method: 'pago_movil' }, { rate: 40 }).valid).toBe(false);

        expect(assertCheckoutInvariants({
            changeUsd: 5,
            changeTotalBs: 200,
            rate: 40,
            changeBreakdown: {
                changeUsdGiven: 3,
                changeBsGiven: 0,
                owedUsd: 2,
                owedBs: 80,
            },
            requireComplete: true,
        })).toMatchObject({ valid: true, allocated: 200 });

        expect(assertCheckoutInvariants({
            changeUsd: 5,
            changeTotalBs: 200,
            rate: 40,
            changeBreakdown: {
                changeUsdGiven: 3,
                changeBsGiven: 0,
                owedUsd: 1,
                owedBs: 40,
            },
            requireComplete: true,
        }).valid).toBe(false);
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
