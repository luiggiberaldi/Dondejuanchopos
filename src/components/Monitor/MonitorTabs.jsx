import React from 'react';
import MonitorActivoTab from './MonitorActivoTab';
import MonitorCierresTab from './MonitorCierresTab';
import MonitorInventarioTab from './MonitorInventarioTab';
import MonitorKardexTab from './MonitorKardexTab';
import MonitorCambiosTab from './MonitorCambiosTab';
import MonitorArticlesTab from './MonitorArticlesTab';
import MonitorNominaTab from './MonitorNominaTab';
import MonitorGastosTab from './MonitorGastosTab';
import MonitorDeudasTab from './MonitorDeudasTab';

/**
 * Renderiza la pestaña activa del Monitor de Supervisión.
 * Recibe el contexto completo como un único objeto props; cada pestaña
 * extrae de él solo lo que necesita.
 */
export default function MonitorTabs(props) {
    const { viewTab } = props;
    return (
        <div className="space-y-6">
                {/* ── SECCIÓN 1: TURNO ACTIVO ── */}
                {viewTab === 'activo' && (
                    <MonitorActivoTab {...props} />
                )}

                {/* ── SECCIÓN 2: CIERRES DE CAJA (HISTORIAL + DETALLE ARQUEO) ── */}
                {viewTab === 'cierres' && (
                    <MonitorCierresTab {...props} />
                )}

                {/* ── SECCIÓN 3: INVENTARIO EN TIEMPO REAL ── */}
                {viewTab === 'inventario' && (
                    <MonitorInventarioTab {...props} />
                )}

                {/* ── SECCIÓN 4: KARDEX REMOTO BAJO DEMANDA ── */}
                {viewTab === 'kardex' && (
                    <MonitorKardexTab {...props} />
                )}

                {/* ── SECCIÓN 5: HISTORIAL Y GESTIÓN DEDICADA DE CAMBIOS ── */}
                {viewTab === 'cambios' && (
                    <MonitorCambiosTab {...props} />
                )}

                {/* ── SECCIÓN 6: REPORTES POR ARTÍCULOS ── */}
                {viewTab === 'articulos' && (
                    <MonitorArticlesTab {...props} />
                )}

                {/* ── SECCIÓN 7: CUENTAS POR COBRAR Y DEUDAS ── */}
                {viewTab === 'deudas' && (
                    <MonitorDeudasTab {...props} />
                )}

                {/* ── SECCIÓN 8: NÓMINA Y CONSUMOS ── */}
                {viewTab === 'nomina' && (
                    <MonitorNominaTab {...props} />
                )}

                {/* ── SECCIÓN 9: DESGLOSE DE GASTOS Y CONSUMO INTERNO DEL DÍA / TURNO ── */}
                {viewTab === 'gastos' && (
                    <MonitorGastosTab {...props} />
                )}
        </div>
    );
}
