import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearEgressMetrics,
    exportEgressReport,
    flushEgressMetrics,
    getEgressReport,
    instrumentSupabaseFetch,
    recordEgressMetric,
    setEgressMeterEnabled,
} from '../src/utils/egressMeter';

beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
});
afterEach(() => {
    clearEgressMetrics();
    vi.useRealTimers();
});

describe('medidor local de egress', () => {
    it('agrega por día/ruta y conserva únicamente método, clase de estado y bytes', () => {
        recordEgressMetric({ project: 'cloud-sync', service: 'rest', route: 'table/sync_documents', method: 'POST', status: '2xx', requestBytes: 100, responseBytes: 40, responseSizeSource: 'header' });
        recordEgressMetric({ project: 'cloud-sync', service: 'rest', route: 'table/sync_documents', method: 'POST', status: '2xx', requestBytes: 100, responseBytes: 40, responseSizeSource: 'header' });
        flushEgressMetrics();

        const raw = localStorage.getItem('dj_egress_meter_v1');
        expect(raw).not.toContain('sale secret');
        const report = getEgressReport(1);
        expect(report.totals).toMatchObject({ requests: 2, requestBytes: 200, responseBytes: 80, responseSizesFromHeaders: 2 });
        expect(report.groups).toHaveLength(1);
        expect(report.disclaimer).toContain('Estimación');
    });

    it('clasifica tablas, RPC, auth y storage sin conservar query params ni IDs', async () => {
        const fetch = instrumentSupabaseFetch('cloud-sync', vi.fn(async () => new Response('ok', {
            status: 200,
            headers: { 'content-length': '2' },
        })));
        await fetch('https://abc.supabase.co/rest/v1/sync_documents?device_id=eq.SECRET_DEVICE&apikey=SECRET', {
            method: 'POST', headers: { Authorization: 'Bearer SECRET' }, body: '{"payload":[1]}',
        });
        flushEgressMetrics();
        const raw = localStorage.getItem('dj_egress_meter_v1');
        expect(raw).not.toContain('SECRET');
        expect(raw).not.toContain('SECRET_DEVICE');
        const report = getEgressReport(1);
        expect(report.groups[0]).toMatchObject({ project: 'supabase-abc', service: 'rest', route: 'table/sync_documents', method: 'POST' });
        expect(report.totals.responseBytes).toBe(2);
    });

    it('cuenta fallos de transporte/HTTP y deja tamaños de respuesta sin cabecera como desconocidos', async () => {
        const fetch = instrumentSupabaseFetch('licensing', vi.fn(async () => new Response('forbidden', { status: 401 })));
        await fetch('https://abc.supabase.co/rest/v1/licenses?select=secret');
        flushEgressMetrics();
        const report = getEgressReport(1);
        expect(report.totals).toMatchObject({ requests: 1, failures: 1, responseBytes: 0, responseSizeUnknown: 1 });
        expect(report.responseBytesCoverage.unknown).toBe(1);
    });

    it('no agrega datos cuando el medidor está pausado y exporta solo el reporte agregado', () => {
        setEgressMeterEnabled(false);
        recordEgressMetric({ route: 'rpc/private-name', requestBytes: 50 });
        flushEgressMetrics();
        expect(getEgressReport(1).totals.requests).toBe(0);
        setEgressMeterEnabled(true);
        recordEgressMetric({ route: 'rpc/ping', requestBytes: 50 });
        expect(exportEgressReport(1)).toContain('requestBytes');
    });

    it('expone la API de consola sin interfaz ni fuga de datos', async () => {
        recordEgressMetric({ project: 'cloud-sync', service: 'rest', route: 'table/sync_documents?device_id=eq.SECRET', method: 'POST', status: '2xx', requestBytes: 10, responseBytes: 5, responseSizeSource: 'header' });
        flushEgressMetrics();

        const api = window.__djEgress;
        expect(api).toBeTruthy();
        expect(Object.keys(api).sort()).toEqual(['clear', 'copy', 'export', 'pause', 'report', 'resume', 'status']);
        expect(api.status()).toMatchObject({ enabled: true, storageKey: 'dj_egress_meter_v1' });
        expect(api.report(1).totals).toMatchObject({ requests: 1, requestBytes: 10, responseBytes: 5 });
        const exported = api.export(1);
        expect(exported).toContain('requestBytes');
        expect(exported).not.toContain('SECRET');
        expect(await api.copy(1)).toBe(false); // clipboard no disponible en jsdom
        expect(api.pause()).toBe(false);
        recordEgressMetric({ route: 'rpc/ping', requestBytes: 99 });
        flushEgressMetrics();
        expect(api.report(1).totals.requests).toBe(1); // pausado: no agrega nuevos
        expect(api.resume()).toBe(true);
        recordEgressMetric({ route: 'rpc/ping', requestBytes: 1 });
        flushEgressMetrics();
        expect(api.report(1).totals.requests).toBe(2);
        api.clear();
        expect(api.report(1).totals.requests).toBe(0);
    });

    it('no registra el medidor como componente de interfaz en Ajustes', () => {
        const settingsPath = resolve(process.cwd(), 'src/components/Settings/tabs/SettingsTabSistema.jsx');
        const panelPath = resolve(process.cwd(), 'src/components/Settings/EgressMeterPanel.jsx');
        const source = readFileSync(settingsPath, 'utf8');
        expect(source).not.toContain('EgressMeterPanel');
        expect(source).not.toContain('egressMeter');
        expect(existsSync(panelPath)).toBe(false);
    });

    it('limita el histórico retenido a 45 días', () => {
        const now = Date.parse('2026-10-01T12:00:00.000Z');
        recordEgressMetric({ route: 'table/products', now: now - 60 * 24 * 60 * 60 * 1000 });
        flushEgressMetrics();
        expect(Object.keys(JSON.parse(localStorage.getItem('dj_egress_meter_v1')).days)).toHaveLength(0);
    });
});
