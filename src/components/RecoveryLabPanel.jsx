import { createElement, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Copy, FlaskConical, ShieldAlert, WifiOff } from 'lucide-react';
import { PRIMARY_POS_DEVICE_ID } from '../config/tenant';
import { RECOVERY_LAB_SCENARIOS, runRecoveryLabSuite, simulateRecoveryScenario } from '../testing/recoveryLabSimulator';

const STATUS_STYLES = {
    passed: 'text-emerald-300', failed: 'text-rose-300', blocked: 'text-amber-300',
    warning: 'text-amber-300', waiting: 'text-sky-300', skipped: 'text-slate-400',
};

const VERDICT_STYLES = {
    recovered: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    'identity-unverified': 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    'protected-read-error': 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    'protected-cloud-error': 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    'protected-no-backup': 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    'protected-no-evidence': 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    'protected-invalid-backup': 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    'approval-required': 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    'restore-aborted': 'border-rose-500/30 bg-rose-500/10 text-rose-100',
    'fresh-install': 'border-slate-600 bg-slate-800/80 text-slate-200',
    'intentional-empty': 'border-slate-600 bg-slate-800/80 text-slate-200',
    'local-data-present': 'border-slate-600 bg-slate-800/80 text-slate-200',
    'not-applicable': 'border-slate-600 bg-slate-800/80 text-slate-200',
    'deferred-import': 'border-sky-500/30 bg-sky-500/10 text-sky-100',
};

function formatCount(value) {
    return new Intl.NumberFormat('es-VE').format(value || 0);
}

export default function RecoveryLabPanel({ onBack }) {
    const [scenarioId, setScenarioId] = useState('recover-empty-pos');
    const [result, setResult] = useState(null);
    const [copyMessage, setCopyMessage] = useState('');
    const [suiteReport, setSuiteReport] = useState(null);
    const selectedScenario = RECOVERY_LAB_SCENARIOS.find(item => item.id === scenarioId);
    const report = useMemo(() => {
        if (suiteReport) return JSON.stringify({ generatedAt: new Date().toISOString(), type: 'full-suite', ...suiteReport }, null, 2);
        return result ? JSON.stringify({ generatedAt: new Date().toISOString(), type: 'single-scenario', scenario: selectedScenario, result }, null, 2) : '';
    }, [result, selectedScenario, suiteReport]);

    const runSimulation = () => {
        setCopyMessage('');
        setSuiteReport(null);
        setResult(simulateRecoveryScenario(scenarioId));
    };

    const runFullSuite = () => {
        setCopyMessage('');
        setResult(null);
        setSuiteReport(runRecoveryLabSuite());
    };

    const copyReport = async () => {
        try {
            await navigator.clipboard.writeText(report);
            setCopyMessage('Reporte copiado. Contiene solo datos sintéticos.');
        } catch {
            setCopyMessage('No se pudo copiar; puedes seleccionar el reporte visible abajo.');
        }
    };

    return (
        <div className="min-h-screen overflow-y-auto bg-slate-950 p-4 text-white sm:p-8">
            <div className="mx-auto max-w-5xl space-y-6 pb-12">
                <header className="flex items-start gap-4">
                    <button onClick={onBack} aria-label="Volver al Panel Dev" className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-slate-300 hover:bg-slate-800">
                        {createElement(ArrowLeft, { size: 18 })}
                    </button>
                    <div className="flex-1">
                        <div className="flex items-center gap-2 text-emerald-300">
                            {createElement(FlaskConical, { size: 20 })}
                            <span className="text-xs font-black uppercase tracking-[0.18em]">Laboratorio aislado · Desarrollo</span>
                        </div>
                        <h1 className="mt-2 text-2xl font-black sm:text-3xl">Simulador de failover</h1>
                        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
                            Prueba decisiones de recuperación con fixtures ficticios. No abre Supabase, no lee IndexedDB/localStorage y no realiza escrituras de ningún tipo.
                        </p>
                    </div>
                </header>

                <section aria-label="Aislamiento de la simulación" className="grid gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/5 p-4 sm:grid-cols-3">
                    <div className="flex items-start gap-3 sm:col-span-2">
                        {createElement(WifiOff, { className: 'mt-0.5 shrink-0 text-sky-300', size: 18 })}
                        <div>
                            <p className="text-sm font-extrabold text-sky-100">Modo simulación, sin red</p>
                            <p className="mt-1 text-xs leading-relaxed text-sky-100/70">El resultado describe lo que una futura política debería hacer. No ejercita ni modifica una instalación real.</p>
                        </div>
                    </div>
                    <div className="rounded-xl border border-slate-700 bg-slate-900/80 p-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ID principal simulado</p>
                        <code className="mt-1 block break-all text-[11px] font-semibold text-slate-200">{PRIMARY_POS_DEVICE_ID}</code>
                    </div>
                </section>

                <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                        <label htmlFor="recovery-scenario" className="text-sm font-black">Escenario de prueba</label>
                        <p className="mt-1 text-xs text-slate-400">Incluye el cero inicial, errores y límites de seguridad.</p>
                        <select id="recovery-scenario" value={scenarioId} onChange={event => { setScenarioId(event.target.value); setResult(null); setSuiteReport(null); setCopyMessage(''); }} className="mt-4 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400">
                            {RECOVERY_LAB_SCENARIOS.map(scenario => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}
                        </select>
                        <p className="mt-3 min-h-10 text-xs leading-relaxed text-slate-400">{selectedScenario.description}</p>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            {[
                                ['Productos', selectedScenario.local.counts.products],
                                ['Ventas', selectedScenario.local.counts.sales],
                                ['Clientes', selectedScenario.local.counts.customers],
                                ['Cuentas', selectedScenario.local.counts.accounts],
                            ].map(([label, count]) => (
                                <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Local · {label}</p>
                                    <p className="mt-1 text-xl font-black tabular-nums">{formatCount(count)}</p>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Copia sintética</p>
                            {selectedScenario.backup.status === 'present' ? (
                                <p className="mt-1 text-xs text-slate-200">
                                    Edad: <strong>{selectedScenario.backup.ageMinutes} min</strong>
                                    {' · '}Productos: <strong>{formatCount(selectedScenario.backup.counts.products)}</strong>
                                    {' · '}Ventas: <strong>{formatCount(selectedScenario.backup.counts.sales)}</strong>
                                    {' · '}Completa: <strong>{selectedScenario.backup.complete ? 'sí' : 'no'}</strong>
                                </p>
                            ) : <p className="mt-1 text-xs text-slate-300">{selectedScenario.backup.status === 'error' ? 'Error de consulta simulado' : 'No disponible'}</p>}
                        </div>
                        <div className="mt-5 grid gap-2 sm:grid-cols-2">
                            <button onClick={runSimulation} className="w-full rounded-xl bg-emerald-500 px-4 py-3 font-black text-slate-950 transition hover:bg-emerald-400 active:scale-[0.99]">
                                Ejecutar escenario
                            </button>
                            <button onClick={runFullSuite} className="w-full rounded-xl border border-emerald-400/40 bg-emerald-950 px-4 py-3 font-black text-emerald-200 transition hover:bg-emerald-900 active:scale-[0.99]">
                                Ejecutar todos y generar reporte
                            </button>
                        </div>
                    </div>

                    <div aria-live="polite" className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
                        <h2 className="flex items-center gap-2 text-sm font-black">{createElement(ShieldAlert, { size: 17, className: 'text-amber-300' })} Resultado / decisión del failover</h2>
                        {!result && !suiteReport ? (
                            <div className="flex min-h-64 flex-col items-center justify-center text-center text-slate-500">
                                {createElement(FlaskConical, { size: 32, className: 'mb-3 text-slate-700' })}
                                <p className="text-sm font-bold">Aún no ejecutas una prueba</p>
                                <p className="mt-1 text-xs">Puedes probar un escenario o ejecutar automáticamente la matriz completa.</p>
                            </div>
                        ) : suiteReport ? (
                            <>
                                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                                    <p className="text-base font-black text-emerald-100">Reporte automático de la matriz completa</p>
                                    <p className="mt-1 text-xs text-emerald-100/80">{suiteReport.total} escenarios · {suiteReport.recovered} recuperables simulados · {suiteReport.protected} protegidos · {suiteReport.deferred} diferidos</p>
                                </div>
                                <ul className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
                                    <li className={`rounded-lg border p-2 ${suiteReport.safety.noNetworkRequests ? 'border-emerald-700 text-emerald-200' : 'border-rose-600 text-rose-200'}`}>Red: {suiteReport.safety.noNetworkRequests ? '0' : 'fallo'}</li>
                                    <li className={`rounded-lg border p-2 ${suiteReport.safety.noLocalWrites ? 'border-emerald-700 text-emerald-200' : 'border-rose-600 text-rose-200'}`}>Escrituras locales: {suiteReport.safety.noLocalWrites ? '0' : 'fallo'}</li>
                                    <li className={`rounded-lg border p-2 ${suiteReport.safety.noCloudWrites ? 'border-emerald-700 text-emerald-200' : 'border-rose-600 text-rose-200'}`}>Escrituras Cloud: {suiteReport.safety.noCloudWrites ? '0' : 'fallo'}</li>
                                </ul>
                                <ol className="mt-3 max-h-80 space-y-2 overflow-auto">
                                    {suiteReport.evaluations.map(item => (
                                        <li key={item.scenarioId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                            <span className="text-xs font-bold text-slate-200">{item.label}</span>
                                            <span className={`shrink-0 text-[10px] font-black uppercase ${item.result.policy.blockCloudPublish ? 'text-amber-300' : 'text-emerald-300'}`}>{item.result.verdict}</span>
                                        </li>
                                    ))}
                                </ol>
                                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950 p-3">
                                    <p className="text-[10px] text-slate-400">{copyMessage || 'Reporte JSON con cada decisión sintética disponible abajo.'}</p>
                                    <button onClick={copyReport} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-800">{createElement(Copy, { size: 13 })} Copiar reporte</button>
                                </div>
                                <details className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3"><summary className="cursor-pointer text-xs font-bold text-slate-300">Ver reporte JSON completo</summary><pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] text-slate-400">{report}</pre></details>
                            </>
                        ) : (
                            <>
                                <div className={`mt-4 rounded-xl border p-4 ${VERDICT_STYLES[result.verdict] || VERDICT_STYLES['protected-no-evidence']}`}>
                                    <p className="text-base font-black">{result.headline}</p>
                                    <p className="mt-1 text-xs leading-relaxed opacity-80">{result.explanation}</p>
                                </div>
                                <ol className="mt-4 space-y-2">
                                    {result.steps.map((step, index) => (
                                        <li key={`${step.label}-${index}`} className="flex gap-3 rounded-lg border border-slate-800/70 bg-slate-950/50 p-3">
                                            {step.status === 'passed'
                                                ? createElement(CheckCircle2, { size: 15, className: `mt-0.5 shrink-0 ${STATUS_STYLES[step.status]}` })
                                                : createElement(CircleAlert, { size: 15, className: `mt-0.5 shrink-0 ${STATUS_STYLES[step.status] || 'text-slate-400'}` })}
                                            <div>
                                                <p className={`text-xs font-extrabold ${STATUS_STYLES[step.status] || 'text-slate-300'}`}>{step.label}</p>
                                                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{step.detail}</p>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                                <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <h3 className="text-xs font-black">Garantías del laboratorio</h3>
                                        <button onClick={copyReport} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 hover:bg-slate-800">
                                            {createElement(Copy, { size: 13 })} Copiar reporte
                                        </button>
                                    </div>
                                    <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
                                        <li>• Solicitudes de red: {result.policy.networkRequestsPerformed}</li>
                                        <li>• Escrituras locales/cloud: {result.policy.localWritesPerformed}/{result.policy.cloudWritesPerformed}</li>
                                        <li>• Publicación cloud bloqueada: {result.policy.blockCloudPublish ? 'sí' : 'no aplica'}</li>
                                        <li>• Perfil: {result.policy.detectedIdentity === PRIMARY_POS_DEVICE_ID ? 'principal' : result.policy.detectedIdentity}</li>
                                    </ul>
                                    <p className="mt-2 text-[10px] text-slate-500">{copyMessage || result.policy.note}</p>
                                </div>
                                <details className="mt-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
                                    <summary className="cursor-pointer text-xs font-bold text-slate-300">Ver reporte JSON sintético</summary>
                                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[10px] text-slate-400">{report}</pre>
                                </details>
                            </>
                        )}
                    </div>
                </section>
                <p className="text-center text-[10px] text-slate-600">Herramienta de diagnóstico exclusivamente de desarrollo. No es una restauración real ni verifica credenciales, RLS o disponibilidad de Supabase.</p>
            </div>
        </div>
    );
}
