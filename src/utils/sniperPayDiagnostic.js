// src/utils/sniperPayDiagnostic.js
// Diagnóstico "Sniper" de eventos y validaciones del botón PAGAR (LISTO)

const logs = [];

export function sniperLog(step, message, data = {}) {
    const time = new Date().toLocaleTimeString('es-VE');
    const entry = `[SNIPER ${time}] ${step}: ${message} ${Object.keys(data).length > 0 ? JSON.stringify(data) : ''}`;
    console.log(`%c${entry}`, 'background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 6px; rounded: 4px;');
    logs.push(entry);
    if (logs.length > 100) logs.shift();
}

export function getSniperLogs() {
    return [...logs];
}

if (typeof window !== 'undefined') {
    window._sniperPayDiagnostic = () => {
        console.group('--- REPORTES DE DIAGNÓSTICO SNIPER (PAGO) ---');
        logs.forEach(l => console.log(l));
        console.groupEnd();
        return logs;
    };
}
