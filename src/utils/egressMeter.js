const STORAGE_KEY = 'dj_egress_meter_v1';
const ENABLED_KEY = 'dj_egress_meter_enabled';
const MAX_DAYS = 45;
const MAX_GROUPS_PER_DAY = 120;
const MAX_PENDING_GROUPS = 240;
const FLUSH_DELAY_MS = 2000;
const pending = new Map();
let flushTimer = null;
let webSocketInstrumented = false;
const projectByOrigin = new Map();

function utf8Length(value) {
    try { return new TextEncoder().encode(value).length; } catch { return value.length * 2; }
}

function bodyByteLength(body) {
    if (body == null) return 0;
    if (typeof body === 'string') return utf8Length(body);
    if (body instanceof ArrayBuffer) return body.byteLength;
    if (ArrayBuffer.isView(body)) return body.byteLength;
    if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
    // FormData/streams are intentionally not inspected to avoid reading user data.
    return 0;
}

function headerByteLength(headers) {
    if (!headers) return 0;
    try {
        const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
        return entries.reduce((size, [key, value]) => size + utf8Length(`${key}: ${value}\r\n`), 0);
    } catch {
        return 0;
    }
}

function requestByteEstimate(input, init, rawUrl, method) {
    // Size-only accounting: query values and credentials are never retained.
    return utf8Length(rawUrl) + utf8Length(method) + headerByteLength(init?.headers || input?.headers) + bodyByteLength(init?.body);
}

function statusClass(status) {
    if (!status) return 'network-error';
    return `${Math.floor(status / 100)}xx`;
}

function serviceAndRoute(rawUrl) {
    try {
        const pathname = new URL(rawUrl, globalThis.location?.href || 'https://local.invalid').pathname;
        const parts = pathname.split('/').filter(Boolean);
        if (parts[0] === 'rest' && parts[1] === 'v1') {
            if (parts[2] === 'rpc') return { service: 'rest', route: `rpc/${parts[3] || 'unknown'}` };
            return { service: 'rest', route: `table/${parts[2] || 'unknown'}` };
        }
        if (parts[0] === 'auth' && parts[1] === 'v1') {
            const known = new Set(['token', 'user', 'authorize', 'logout', 'recover', 'verify', 'callback', 'otp', 'signup', 'health']);
            return { service: 'auth', route: `auth/${known.has(parts[2]) ? parts[2] : 'other'}` };
        }
        if (parts[0] === 'storage' && parts[1] === 'v1') {
            const bucket = parts[2] === 'object'
                ? (parts[3] === 'public' || parts[3] === 'sign' ? parts[4] : parts[3])
                : null;
            const safeBucket = /^[a-zA-Z0-9_-]{1,40}$/.test(bucket || '') ? bucket : 'other';
            return { service: 'storage', route: `object/${safeBucket}` };
        }
        if (parts[0] === 'realtime' && parts[1] === 'v1') return { service: 'realtime', route: 'websocket' };
        if (parts[0] === 'functions' && parts[1] === 'v1') {
            const name = /^[a-zA-Z0-9_-]{1,50}$/.test(parts[2] || '') ? parts[2] : 'other';
            return { service: 'functions', route: name };
        }
        return { service: 'other', route: 'other' };
    } catch {
        return { service: 'other', route: 'other' };
    }
}

function makeGroupKey(group) {
    return [group.project, group.transport, group.service, group.route, group.method, group.status].join('|');
}

function readStore() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return parsed?.version === 1 && parsed.days && typeof parsed.days === 'object'
            ? parsed : { version: 1, days: {} };
    } catch {
        return { version: 1, days: {} };
    }
}

function addToAggregate(target, delta) {
    for (const field of ['requests', 'failures', 'requestBytes', 'responseBytes', 'responseSizesFromHeaders', 'responseSizesFromBody', 'responseSizeUnknown', 'connections', 'messagesSent', 'messagesReceived']) {
        target[field] = (target[field] || 0) + (delta[field] || 0);
    }
}

function dateKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}

function safeProject(project) {
    return /^[a-zA-Z0-9_-]{1,30}$/.test(project || '') ? project : 'supabase';
}

export function isEgressMeterEnabled() {
    try { return localStorage.getItem(ENABLED_KEY) !== 'false'; } catch { return true; }
}

export function setEgressMeterEnabled(enabled) {
    try { localStorage.setItem(ENABLED_KEY, enabled ? 'true' : 'false'); } catch { /* local-only */ }
}

export function recordEgressMetric({
    project = 'supabase', transport = 'http', service = 'other', route = 'other',
    method = 'OTHER', status = 'unknown', requestBytes = 0, responseBytes = 0,
    failures = 0, responseSizeSource = 'unknown', connections = 0, messagesSent = 0, messagesReceived = 0,
    now = Date.now(),
} = {}) {
    if (!isEgressMeterEnabled()) return;
    const group = {
        project: safeProject(project),
        transport: transport === 'websocket' ? 'websocket' : 'http',
        service: /^[a-z]{1,20}$/.test(service) ? service : 'other',
        route: /^[a-zA-Z0-9_/-]{1,80}$/.test(route) ? route : 'other',
        method: /^[A-Z]{1,12}$/.test(method) ? method : 'OTHER',
        status: /^[a-z0-9-]{1,16}$/.test(String(status)) ? String(status) : 'unknown',
    };
    const key = makeGroupKey(group);
    const id = `${dateKey(now)}|${key}`;
    let value = pending.get(id);
    if (!value && pending.size >= MAX_PENDING_GROUPS) {
        const boundedGroup = { ...group, route: 'other' };
        const boundedKey = makeGroupKey(boundedGroup);
        const boundedId = `${dateKey(now)}|${boundedKey}`;
        value = pending.get(boundedId);
        if (!value) {
            value = { ...boundedGroup, requests: 0, failures: 0, requestBytes: 0, responseBytes: 0, responseSizesFromHeaders: 0, responseSizesFromBody: 0, responseSizeUnknown: 0, connections: 0, messagesSent: 0, messagesReceived: 0 };
            pending.set(boundedId, value);
        }
        value.requests += group.transport === 'http' ? 1 : 0;
        value.failures += failures;
        value.requestBytes += Math.max(0, Number(requestBytes) || 0);
        value.responseBytes += Math.max(0, Number(responseBytes) || 0);
        value.connections += connections;
        value.messagesSent += messagesSent;
        value.messagesReceived += messagesReceived;
        if (group.transport === 'http') value.responseSizeUnknown += responseSizeSource === 'unknown' ? 1 : 0;
        if (!flushTimer) flushTimer = setTimeout(flushEgressMetrics, FLUSH_DELAY_MS);
        return;
    }
    if (!value) {
        value = { ...group, requests: 0, failures: 0, requestBytes: 0, responseBytes: 0, responseSizesFromHeaders: 0, responseSizesFromBody: 0, responseSizeUnknown: 0, connections: 0, messagesSent: 0, messagesReceived: 0 };
        pending.set(id, value);
    }
    if (group.transport === 'http') value.requests += 1;
    value.failures += failures;
    value.requestBytes += Math.max(0, Number(requestBytes) || 0);
    value.responseBytes += Math.max(0, Number(responseBytes) || 0);
    if (group.transport === 'http') {
        if (responseSizeSource === 'header') value.responseSizesFromHeaders += 1;
        else if (responseSizeSource === 'body') value.responseSizesFromBody += 1;
        else if (responseSizeSource === 'unknown') value.responseSizeUnknown += 1;
    }
    value.connections += connections;
    value.messagesSent += messagesSent;
    value.messagesReceived += messagesReceived;
    if (!flushTimer) flushTimer = setTimeout(flushEgressMetrics, FLUSH_DELAY_MS);
}

export function flushEgressMetrics() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (pending.size === 0) return;
    const store = readStore();
    for (const [id, delta] of pending) {
        const [day] = id.split('|');
        const groups = store.days[day] || (store.days[day] = []);
        const key = makeGroupKey(delta);
        const group = groups.find(item => makeGroupKey(item) === key);
        if (!group && groups.length < MAX_GROUPS_PER_DAY) {
            const newGroup = { ...delta, requests: 0, failures: 0, requestBytes: 0, responseBytes: 0, responseSizesFromHeaders: 0, responseSizesFromBody: 0, responseSizeUnknown: 0, connections: 0, messagesSent: 0, messagesReceived: 0 };
            groups.push(newGroup);
            addToAggregate(newGroup, delta);
        }
        if (group) addToAggregate(group, delta);
    }
    pending.clear();
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    for (const day of Object.keys(store.days)) {
        if (Date.parse(`${day}T00:00:00.000Z`) < cutoff) delete store.days[day];
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* meter never blocks business operations */ }
}

export function getEgressReport(days = 7, now = Date.now()) {
    flushEgressMetrics();
    const store = readStore();
    const cutoff = now - Math.max(1, Math.min(MAX_DAYS, days)) * 24 * 60 * 60 * 1000;
    const groups = [];
    for (const [day, dailyGroups] of Object.entries(store.days)) {
        if (Date.parse(`${day}T23:59:59.999Z`) < cutoff) continue;
        for (const group of dailyGroups) groups.push({ day, ...group });
    }
    const totals = groups.reduce((sum, group) => {
        addToAggregate(sum, group);
        return sum;        }, { requests: 0, failures: 0, requestBytes: 0, responseBytes: 0, responseSizesFromHeaders: 0, responseSizesFromBody: 0, responseSizeUnknown: 0, connections: 0, messagesSent: 0, messagesReceived: 0 });

    const byRoute = new Map();
    const byDay = new Map();
    for (const group of groups) {
        const key = makeGroupKey(group);
        const existing = byRoute.get(key);
        if (existing) addToAggregate(existing, group);
        else byRoute.set(key, { ...group, day: undefined });

        const dayTotals = byDay.get(group.day) || { day: group.day, requests: 0, failures: 0, requestBytes: 0, responseBytes: 0, responseSizesFromHeaders: 0, responseSizesFromBody: 0, responseSizeUnknown: 0, connections: 0, messagesSent: 0, messagesReceived: 0 };
        addToAggregate(dayTotals, group);
        byDay.set(group.day, dayTotals);
    }
    const unavailableResponseBytes = totals.responseSizeUnknown;
    return {
        version: 1,
        disclaimer: 'Estimación desde el cliente; no incluye TLS/framing, cachés, tráfico de red gestionado fuera de fetch ni precisión de factura. Contrastar con Supabase Usage.',
        generatedAt: new Date(now).toISOString(),
        days: Math.max(1, Math.min(MAX_DAYS, days)),
        totals,
        byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
        responseBytesCoverage: {
            measuredFromContentLength: totals.responseSizesFromHeaders,
            measuredFromClonedBody: totals.responseSizesFromBody,
            unknown: unavailableResponseBytes,
        },
        groups: [...byRoute.values()].sort((a, b) => (b.requestBytes + b.responseBytes) - (a.requestBytes + a.responseBytes)),
    };
}

export function exportEgressReport(days = 7) {
    return JSON.stringify(getEgressReport(days), null, 2);
}

export function clearEgressMetrics() {
    pending.clear();
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* local-only */ }
}

export function instrumentSupabaseFetch(project, baseFetch = globalThis.fetch) {
    if (typeof baseFetch !== 'function') return baseFetch;
    return async (input, init) => {
        const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
        const { service, route } = serviceAndRoute(rawUrl);
        const method = String(init?.method || input?.method || 'GET').toUpperCase();
        let projectLabel = safeProject(project);
        try {
            const currentHost = new URL(rawUrl, globalThis.location?.href || 'https://local.invalid').hostname;
            if (currentHost.endsWith('.supabase.co')) projectLabel = `supabase-${currentHost.split('.')[0]}`;
        } catch { /* retain configured project label */ }
        const requestBytes = requestByteEstimate(input, init, rawUrl, method);
        try {
            const response = await baseFetch(input, init);
            const contentLength = Number(response.headers?.get?.('content-length'));
            const record = (responseBytes, responseSizeSource) => recordEgressMetric({
                project: projectLabel, transport: 'http', service, route, method,
                status: statusClass(response.status), requestBytes,
                responseBytes, responseSizeSource, failures: response.status >= 400 ? 1 : 0,
            });
            // Do not clone/read response bodies: that could double memory and CPU
            // for large sales payloads. Missing Content-Length stays explicitly unknown.
            if (Number.isFinite(contentLength) && contentLength > 0) record(contentLength, 'header');
            else record(0, 'unknown');
            return response;
        } catch (error) {
            recordEgressMetric({ project: projectLabel, transport: 'http', service, route, method, status: 'network-error', requestBytes, failures: 1 });
            throw error;
        }
    };
}

export function instrumentSupabaseWebSocket(projectOrigins = {}) {
    for (const [origin, project] of Object.entries(projectOrigins)) {
        try { projectByOrigin.set(new URL(origin).origin, safeProject(project)); } catch { /* invalid/missing URL */ }
    }
    if (webSocketInstrumented || typeof globalThis.WebSocket !== 'function') return;
    const NativeWebSocket = globalThis.WebSocket;

    class MeteredWebSocket extends NativeWebSocket {
        constructor(url, protocols) {
            super(url, protocols);
            let project = 'supabase';
            try { project = projectByOrigin.get(new URL(String(url)).origin) || project; } catch { /* route unknown */ }
            const { service, route } = serviceAndRoute(String(url));
            const recordMessage = (direction, bytes) => recordEgressMetric({
                project, transport: 'websocket', service, route,
                method: direction === 'sent' ? 'SEND' : 'RECEIVE', status: 'message',
                requestBytes: direction === 'sent' ? bytes : 0,
                responseBytes: direction === 'received' ? bytes : 0,
                messagesSent: direction === 'sent' ? 1 : 0,
                messagesReceived: direction === 'received' ? 1 : 0,
            });
            const nativeSend = this.send;
            this.send = function (data) {
                recordMessage('sent', typeof data === 'string' ? utf8Length(data) : bodyByteLength(data));
                return nativeSend.call(this, data);
            };
            this.addEventListener('message', event => {
                const data = event.data;
                const byteLength = typeof data === 'string' ? utf8Length(data) : bodyByteLength(data);
                recordMessage('received', byteLength);
            });
            this.addEventListener('open', () => recordEgressMetric({
                project, transport: 'websocket', service, route, method: 'CONNECT', status: '101', connections: 1,
            }), { once: true });
            this.addEventListener('error', () => recordEgressMetric({
                project, transport: 'websocket', service, route, method: 'CONNECT', status: 'network-error', failures: 1,
            }), { once: true });
        }
    }
    globalThis.WebSocket = MeteredWebSocket;
}

// Console-only collection API: no UI, no network. The operator opens DevTools
// and runs `copy(__djEgress.export(30))` (or `__djEgress.report(30)` for the
// object) to hand the local aggregates to a developer. Data never leaves the
// browser unless the operator explicitly copies it.
function installConsoleApi() {
    if (typeof window === 'undefined' || window.__djEgress) return;
    Object.defineProperty(window, '__djEgress', {
        value: Object.freeze({
            report: (days = 7) => getEgressReport(days),
            export: (days = 7) => exportEgressReport(days),
            copy: async (days = 7) => {
                try {
                    await navigator.clipboard.writeText(exportEgressReport(days));
                    return true;
                } catch {
                    return false;
                }
            },
            clear: () => { clearEgressMetrics(); return true; },
            pause: () => { setEgressMeterEnabled(false); return isEgressMeterEnabled(); },
            resume: () => { setEgressMeterEnabled(true); return isEgressMeterEnabled(); },
            status: () => ({
                enabled: isEgressMeterEnabled(),
                storageKey: STORAGE_KEY,
                enabledKey: ENABLED_KEY,
            }),
        }),
        writable: false,
        configurable: false,
        enumerable: false,
    });
}
installConsoleApi();

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushEgressMetrics);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushEgressMetrics();
    });
}

export const EGRESS_METER_STORAGE_KEY = STORAGE_KEY;
