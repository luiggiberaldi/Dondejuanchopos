import fs from 'node:fs';
import path from 'node:path';
import { processSaleTransaction } from '../src/utils/checkoutProcessor.js';
import { storageService } from '../src/utils/storageService.js';

async function main() {
    console.log('=== TEST REPRODUCING CHECKOUT EXCEPTION ===');

    // Load data from snapshot
    const data = JSON.parse(fs.readFileSync('backups_extracted/sync_snapshot_PDA-V2-ED46F23C375734BF8DF4CC7DC4A4D39F_latest.json', 'utf8'));
    const products = data.collections.store.bodega_products_v1 || [];
    const customers = data.collections.store.bodega_customers_v1 || [];
    const sales = data.collections.store.bodega_sales_v1 || [];

    // Initialize local storage / localStore
    await storageService.setItem('bodega_products_v1', products);
    await storageService.setItem('bodega_customers_v1', customers);
    await storageService.setItem('bodega_sales_v1', sales);

    // Find a product or create cart matching $1.74
    // Let's create a cart item
    const cart = [{
        id: 'prod_test_1',
        name: 'Producto Test 1.74',
        qty: 1,
        priceUsd: 1.74,
        costBs: 0,
        costUsd: 0,
        isWeight: false,
        _mode: 'unit',
        stock: 10
    }];

    const effectiveRate = 977.011494; // 1700 / 1.74
    const cartTotalUsd = 1.74;
    const cartTotalBs = 1700;

    const payments = [{
        methodId: 'pago_movil',
        currency: 'BS',
        amount: 1720,
        amountBs: 1720,
        amountUsd: 1.7604,
        methodLabel: 'Pago Móvil',
        isCash: false
    }];

    const changeBreakdown = {
        changeUsdGiven: 0,
        changeBsGiven: 0,
        tipDonated: {
            amountUsd: 0.02,
            amountBs: 20,
            currency: 'BS',
            partial: false,
            physicalGivenUsd: 0,
            physicalGivenBs: 0
        },
        changeOwed: null,
        changeVoucher: null,
        vueltoParaMonederoUsd: 0,
        vueltoParaMonederoBs: 0,
        vueltoParaMonederoCurrency: 'BS',
        checkoutOperationId: 'test_op_123'
    };

    const paymentMethods = [
        { id: 'efectivo_usd', label: 'Efectivo $', currency: 'USD', isCash: true, isEnabled: true },
        { id: 'efectivo_bs', label: 'Efectivo Bs', currency: 'BS', isCash: true, isEnabled: true },
        { id: 'pago_movil', label: 'Pago Móvil', currency: 'BS', isCash: false, isEnabled: true },
        { id: 'punto_de_venta', label: 'Punto de Venta', currency: 'BS', isCash: false, isEnabled: true },
        { id: 'transferencia', label: 'Transferencia', currency: 'BS', isCash: false, isEnabled: true }
    ];

    try {
        console.log('Calling processSaleTransaction...');
        const res = await processSaleTransaction({
            cart,
            cartTotalUsd,
            cartTotalBs,
            cartSubtotalUsd: cartTotalUsd,
            payments,
            changeBreakdown,
            selectedCustomerId: '',
            customers,
            products,
            effectiveRate,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: true,
            bcvRate: effectiveRate,
            paymentMethods,
            checkoutOperationId: 'test_op_123'
        });
        console.log('Result:', res);
    } catch (err) {
        console.error('CAUGHT EXCEPTION:', err);
    }
}

main().catch(console.error);
