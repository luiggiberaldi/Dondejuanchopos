/**
 * divergenceAlert.js — FASE 4 del plan maestro: observabilidad.
 *
 * Detector de humo para el incidente clase "15 h de ventas sin llegar a la nube"
 * (11→12-09): compara lo que la NUBE sabe (Doc 60 vía el Monitor) contra lo que la
 * PC declara tener (su backup completo) y eleva un veredicto accionable.
 *
 * Puro: sin red, sin storage — testeable al 100%.
 */

/** Extrae { count, maxSaleNumber } del bodega_sales_v1 dentro de un backup remoto. */
export function summarizeBackupSales(backup) {
    const sales =
        backup?.data?.idb?.bodega_sales_v1
        || backup?.data?.bodega_sales_v1
        || backup?.payload?.sales
        || backup?.bodega_sales_v1
        || null;
    if (!Array.isArray(sales)) return { count: null, maxSaleNumber: null };
    let max = 0;
    for (const s of sales) {
        const n = Number(s?.saleNumber);
        if (Number.isFinite(n) && n > max) max = n;
    }
    return { count: sales.length, maxSaleNumber: max };
}

/** Edad en minutos de un timestamp ISO (Infinity si es inválido/ausente). */
export function ageMinutes(iso, nowMs = Date.now()) {
    const t = new Date(iso || '').getTime();
    if (!Number.isFinite(t)) return Infinity;
    return Math.max(0, (nowMs - t) / 60_000);
}

/**
 * Veredicto de divergencia.
 *
 * @param {object} p
 * @param {number}  p.cloudSalesCount   - registros en Doc 60 (fuente canónica).
 * @param {number|null} p.pcSalesCount   - registros que la PC declara en su backup.
 * @param {string|null} p.pcBackupAt     - updated_at del backup del PC (ISO).
 * @param {number}  [p.staleAfterMin=30] - edad máxima aceptable del backup.
 * @param {boolean} [p.pcOnline=false]   - presence del PC (heartbeat del Monitor):
 *        si está EN LÍNEA, un backup viejo NO es alarma (los backups se hacen bajo
 *        demanda/al cerrar, no son heartbeat) → se degrada a nota informativa.
 * @param {number}  [p.nowMs]            - inyectable para tests.
 * @returns {{level:'ok'|'warn'|'stale'|'unknown', title:string, message:string, missing:number}}
 */
export function computeDivergence({ cloudSalesCount, pcSalesCount, pcBackupAt, staleAfterMin = 30, pcOnline = false, nowMs = Date.now() }) {
    // Divergencia en CUALQUIER dirección: la nube detrás del PC (push bloqueado)
    // o el PC detrás de la nube (historial truncado aún sin reconstruir). Ambas
    // merecen visibilidad; el mensaje distingue el signo.
    const delta = Number.isFinite(pcSalesCount) && Number.isFinite(cloudSalesCount)
        ? pcSalesCount - (cloudSalesCount || 0)
        : null;
    const missing = delta == null ? null : Math.abs(delta);
    const age = ageMinutes(pcBackupAt, nowMs);

    if (!Number.isFinite(cloudSalesCount) || pcSalesCount == null) {
        return {
            level: 'unknown',
            title: 'Sync sin verificar',
            message: 'No hay backup reciente del PC para comparar. Ejecuta la verificación.',
            missing: null,
        };
    }
    if (age > staleAfterMin && !pcOnline) {
        return {
            level: 'stale',
            title: 'PC sin confirmación reciente',
            message: `El último backup del PC tiene ${fmtAge(age)} (límite ${staleAfterMin} min) y no responde al presence. Si la caja debería estar en línea, revisa su conexión.`,
            missing,
        };
    }
    if (missing > 0) {
        const nubeDetras = delta > 0;
        return {
            level: 'warn',
            title: `⚠ ${missing} registro${missing === 1 ? '' : 's'} de divergencia PC ↔ nube`,
            message: nubeDetras
                ? `PC declara ${pcSalesCount} registros, la nube tiene ${cloudSalesCount}: hay ventas que no llegaron a la nube. Si el número crece, hay que intervenir (revisar push de FASE 1).`
                : `PC declara ${pcSalesCount} registros, la nube tiene ${cloudSalesCount}: el historial local del PC está truncado o desactualizado. Si FASE 2 está armada, se resuelve al cierre; si no, reconstruir.`,
            missing,
        };
    }
    return {
        level: 'ok',
        title: 'Sync al día',
        message: `PC y nube coinciden (${cloudSalesCount} registros).`
            + (age > staleAfterMin ? ` El backup es de hace ${fmtAge(age)} — normal: se refresca al facturar/cerrar o bajo demanda (el PC está en línea).` : ''),
        missing: 0,
    };
}

function fmtAge(minutes) {
    if (!Number.isFinite(minutes)) return 'desconocida';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
}
