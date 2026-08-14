import { useState, useEffect } from 'react';
import { calculateChangeAllocation } from '../../../../core/CheckoutPaymentEngine';
import { procesarImpactoCliente } from '../../../../utils/financialLogic';

/**
 * useClientWallet — Portado de Listo POS ModalPago.
 * Calcula la proyección de saldo del cliente cuando hay vuelto acreditado.
 */
export const useClientWallet = (clienteSeleccionado, clientes, modo, cambioUSD, isChangeCredited, distVueltoUSD, distVueltoBS, tasaSegura, changeTotalBs = null) => {
    const [proyeccion, setProyeccion] = useState(null);

    useEffect(() => {
        const clienteObj = Array.isArray(clientes)
            ? clientes.find(c => c.id === clienteSeleccionado)
            : null;
        const safeRate = Number(tasaSegura) > 0 ? Number(tasaSegura) : 0;
        const allocation = calculateChangeAllocation({
            totalChangeUsd: cambioUSD,
            totalChangeBs: changeTotalBs,
            physicalUsd: distVueltoUSD,
            physicalBs: distVueltoBS,
            rate: safeRate,
        });
        const montoAbonarCuenta = modo === 'contado' && isChangeCredited
            ? allocation.remainingUsd
            : 0;

        if (clienteObj && montoAbonarCuenta > 0.001) {
            // La proyección usa exactamente la misma regla que la persistencia:
            // primero reduce deuda y solo el sobrante se convierte en favor.
            const projectedCustomer = procesarImpactoCliente(clienteObj, {
                vueltoParaMonedero: montoAbonarCuenta,
            });
            setProyeccion({
                ...projectedCustomer,
                abono: montoAbonarCuenta,
                abonoBs: allocation.remainingBs,
            });
        } else {
            setProyeccion(null);
        }
    }, [clienteSeleccionado, isChangeCredited, cambioUSD, distVueltoUSD, distVueltoBS, modo, clientes, tasaSegura, changeTotalBs]);

    return { proyeccion };
};
