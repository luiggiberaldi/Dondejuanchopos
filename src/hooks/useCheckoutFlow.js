import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { processSaleTransaction } from '../utils/checkoutProcessor';
import { withLock } from '../utils/withLock';  // FIN-026: lock para apertura de caja.
import { round2 } from '../utils/dinero';
import { CurrencyService } from '../services/CurrencyService'; // FIN-026: safeParse en vez de parseFloat.
import { SALES_KEY } from './useSalesData';
import { useAuthStore } from './store/useAuthStore';

export function useCheckoutFlow({
    cart, cartTotalUsd, cartTotalBs, cartSubtotalUsd,
    selectedCustomerId, customers, setCustomers, products, setProducts,
    effectiveRate, tasaCop, copEnabled, discountData, useAutoRate, bcvRate,
    setSalesData, setShowReceipt, setShowCheckout, setSelectedCustomerId,
    setCart, setCartSelectedIndex, setShowConfetti, setTodayAperturaData, setIsAperturaOpen,
    playCheckout, playError, notifyLowStock, notifySaleComplete, triggerHaptic
}) {

    const handleCheckout = async (payments, changeBreakdown, totalOverrides = null) => {
        triggerHaptic && triggerHaptic();

        const opts = {
            cart,
            cartTotalUsd: totalOverrides?.cartTotalUsd ?? cartTotalUsd,
            cartTotalBs: totalOverrides?.cartTotalBs ?? cartTotalBs,
            cartSubtotalUsd: totalOverrides?.cartSubtotalUsd ?? cartSubtotalUsd,
            payments,
            changeBreakdown,
            selectedCustomerId,
            customers,
            products,
            effectiveRate,
            tasaCop,
            copEnabled,
            discountData,
            useAutoRate,
            bcvRate
        };

        let result;
        try {
            result = await processSaleTransaction(opts);
        } catch (err) {
            console.error('[checkout] Error inesperado en processSaleTransaction:', err);
            showToast('Error al procesar la venta. Intenta de nuevo.', 'error');
            playError();
            return;
        }

        if (!result.success) {
            console.error('Abortando venta:', result.error);
            showToast(result.error, result.error.includes('No se pueden') ? 'warning' : 'error');
            playError();
            return;
        }

        setProducts(result.updatedProducts);
        if (result.updatedCustomers) setCustomers(result.updatedCustomers);
        setSalesData(prev => [result.sale, ...prev]);

        setShowReceipt(result.sale);
        playCheckout();
        setShowConfetti(true);
        notifyLowStock(result.updatedProducts);
        notifySaleComplete && notifySaleComplete(result.sale);

        // Despachar evento para que el Dashboard se entere en caliente
        window.dispatchEvent(new CustomEvent('sales-updated'));

        setCart([]);
        setShowCheckout(false);
        setSelectedCustomerId('');
        setCartSelectedIndex(-1);
    };

    const handleCreateCustomer = async (name, documentId, phone) => {
        const nextCodeNum = customers.reduce((mx, c) => {
            const numPart = parseInt(c.code?.replace('CLI-', ''), 10);
            return isNaN(numPart) ? mx : Math.max(mx, numPart);
        }, 0) + 1;
        const code = `CLI-${String(nextCodeNum).padStart(5, '0')}`;
        const newCustomer = { id: crypto.randomUUID(), code, name, documentId: documentId || '', phone: phone || '', deuda: 0, favor: 0, createdAt: new Date().toISOString() };
        const updated = [...customers, newCustomer];
        try {
            await storageService.setItem('bodega_customers_v1', updated);
            setCustomers(updated);
        } catch (err) {
            console.error('[checkout] Error al guardar cliente:', err);
            showToast('Error al guardar el cliente', 'error');
            return null;
        }
        return newCustomer;
    };

    // FIN-026: handleSaveApertura envuelto en withLock + validación de montos >= 0.
    const handleSaveApertura = async (data) => {
        // Validar montos no negativos.
        const openingUsd = round2(CurrencyService.safeParse(data.openingUsd));
        const openingBs = round2(CurrencyService.safeParse(data.openingBs));
        const openingCop = round2(CurrencyService.safeParse(data.openingCop));

        if (openingUsd < 0 || openingBs < 0 || openingCop < 0) {
            showToast('Los montos de apertura no pueden ser negativos.', 'error');
            if (playError) playError();
            return;
        }

        try {
            const today = new Date().toISOString();
            const activeUser = useAuthStore.getState().usuarioActivo;
            const cajeroNombre = activeUser ? (activeUser.nombre || activeUser.usuario || 'Cajero') : null;

            const aperturaRecord = {
                id: `apertura_${Date.now()}`,
                tipo: 'APERTURA_CAJA',
                openingUsd,
                openingBs,
                // FIN-026: incluir openingCop siempre (aunque sea 0) para trazabilidad.
                openingCop,
                cajero: cajeroNombre,
                cajeroId: activeUser?.id || null,
                timestamp: today,
                cajaCerrada: false
            };

            // FIN-026: envolver en withLock para evitar duplicar aperturas en doble-click.
            await withLock('pos_write_lock', async () => {
                const existingSales = await storageService.getItem(SALES_KEY, []);
                const updatedSales = [...existingSales, aperturaRecord];
                await storageService.setItem(SALES_KEY, updatedSales);
                setTodayAperturaData(aperturaRecord);
            });

            setIsAperturaOpen(false);
            showToast('Caja abierta exitosamente', 'success');
            if (triggerHaptic) triggerHaptic();

            // Despachar evento para notificar al Dashboard
            window.dispatchEvent(new CustomEvent('sales-updated'));

        } catch (error) {
            console.error('Error al guardar apertura:', error);
            showToast('Error al abrir la caja', 'error');
            if (playError) playError();
        }
    };

    return {
        handleCheckout,
        handleCreateCustomer,
        handleSaveApertura,
    };
}
