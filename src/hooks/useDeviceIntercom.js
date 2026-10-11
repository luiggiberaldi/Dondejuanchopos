import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { getCatchupFilter, getInitialCursor, getMessageCursor, INTERCOM_HISTORY_LIMIT, mergeMessages, validateMessage } from '../utils/intercomModel';
import { buildPushRow, describePushRegistrationFailure, isRlsError, registerPushSubscription, PUSH_TABLE } from '../utils/intercomPush';

const READS_TABLE = 'device_message_reads';
const DEFAULT_VAPID_PUBLIC_KEY = 'BKP1Pkm0qyReec6qaCLfgJJuJ5WXQ-VswT-GZ8MNVAsic99mmSTIBxkM8Al_kqUu6ig_IHuQzwNeQz4A_ex_-gk';
const PUSH_PUBLIC_KEY = import.meta.env.VITE_INTERCOM_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;

function pushSupported() {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function fromBase64Url(value) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

export function useDeviceIntercom({ primaryDeviceId, deviceId, senderRole, senderName, onOpenPush, onIncomingMessage }) {
    const [messages, setMessages] = useState([]);
    const [, setReadCursor] = useState(null);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(Boolean(primaryDeviceId && deviceId));
    const [sending, setSending] = useState(false);
    const [failedMessages, setFailedMessages] = useState([]);
    const [error, setError] = useState('');
    const [pushState, setPushState] = useState('unsupported');
    const [pushBusy, setPushBusy] = useState(false);
    const messagesRef = useRef([]);
    const scopeRef = useRef('');
    const initializedRef = useRef('');
    const readCursorRef = useRef(null);
    const readWriteTimerRef = useRef(null);
    const sendInFlightRef = useRef(false);

    const setMergedMessages = useCallback(rows => {
        const merged = mergeMessages(messagesRef.current, rows);
        messagesRef.current = merged;
        setMessages(merged);
    }, []);

    const fetchLatest = useCallback(async ({ initial = false } = {}) => {
        if (!supabaseCloud || !primaryDeviceId || !deviceId) return [];
        const cursor = initial ? null : getInitialCursor(messagesRef.current);
        const incremental = !initial && Boolean(cursor);
        const rows = [];
        let next = cursor;
        let first = true;
        while (first || (incremental && next)) {
            let query = supabaseCloud.from('device_messages')
                .select('id,primary_device_id,sender_device_id,sender_role,sender_name,message,created_at')
                .eq('primary_device_id', primaryDeviceId)
                .order('created_at', { ascending: incremental })
                .order('id', { ascending: incremental })
                .limit(INTERCOM_HISTORY_LIMIT);
            if (incremental && next) query = query.or(getCatchupFilter(next));
            const { data, error: queryError } = await query;
            if (queryError) throw queryError;
            const page = data || [];
            rows.push(...page);
            first = false;
            if (!incremental || page.length < INTERCOM_HISTORY_LIMIT) break;
            next = getMessageCursor(page[page.length - 1]);
        }
        const ordered = incremental ? rows : rows.reverse();
        setMergedMessages(ordered);
        if (initial && ordered.length === 0) messagesRef.current = [];
        return ordered;
    }, [deviceId, primaryDeviceId, setMergedMessages]);

    const fetchReadCursor = useCallback(async () => {
        if (!supabaseCloud || !primaryDeviceId || !deviceId) return null;
        const { data, error: readError } = await supabaseCloud.from(READS_TABLE)
            .select('last_read_at,last_read_message_id')
            .eq('primary_device_id', primaryDeviceId)
            .eq('reader_device_id', deviceId)
            .maybeSingle();
        if (readError) throw readError;
        const cursor = data?.last_read_at && data?.last_read_message_id
            ? { created_at: data.last_read_at, id: data.last_read_message_id }
            : null;
        readCursorRef.current = cursor;
        setReadCursor(cursor);
        return cursor;
    }, [deviceId, primaryDeviceId]);

    const fetchUnreadCount = useCallback(async (cursor = readCursorRef.current) => {
        if (!supabaseCloud || !primaryDeviceId || !deviceId) return;
        let query = supabaseCloud.from('device_messages').select('id', { count: 'exact', head: true })
            .eq('primary_device_id', primaryDeviceId).neq('sender_device_id', deviceId);
        if (cursor) query = query.or(getCatchupFilter(cursor));
        const { count, error: unreadError } = await query;
        if (unreadError) {
            if (unreadError.code === '42501' || unreadError.status === 401 || unreadError.status === 403) {
                setError('Este dispositivo ya no pertenece a un vínculo activo. Vuelve a emparejarlo para acceder al chat.');
            }
            throw unreadError;
        }
        setUnreadCount(count || 0);
    }, [deviceId, primaryDeviceId]);

    const persistReadCursor = useCallback(async cursor => {
        if (!cursor || !supabaseCloud || !primaryDeviceId || !deviceId) return;
        const { error: writeError } = await supabaseCloud.from(READS_TABLE).upsert({
            primary_device_id: primaryDeviceId,
            reader_device_id: deviceId,
            last_read_at: cursor.created_at,
            last_read_message_id: cursor.id,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'primary_device_id,reader_device_id' });
        if (writeError?.code === '42501' || writeError?.status === 401 || writeError?.status === 403) {
            throw new Error('Este dispositivo ya no pertenece a un vínculo activo.');
        }
        if (writeError) throw writeError;
        readCursorRef.current = cursor;
        setReadCursor(cursor);
        await fetchUnreadCount(cursor);
    }, [deviceId, fetchUnreadCount, primaryDeviceId]);

    const markRead = useCallback(() => {
        const cursor = getInitialCursor(messagesRef.current);
        if (!cursor) return;
        clearTimeout(readWriteTimerRef.current);
        readWriteTimerRef.current = setTimeout(() => {
            persistReadCursor(cursor).catch(readError => console.warn('[Intercom] No se pudo guardar lectura:', readError.message));
        }, 350);
    }, [persistReadCursor]);

    const markMessageRead = useCallback(messageId => {
        const message = messagesRef.current.find(item => item.id === messageId);
        const cursor = getMessageCursor(message);
        if (!cursor) return;
        clearTimeout(readWriteTimerRef.current);
        readWriteTimerRef.current = setTimeout(() => {
            persistReadCursor(cursor).catch(readError => console.warn('[Intercom] No se pudo guardar lectura:', readError.message));
        }, 350);
    }, [persistReadCursor]);

    const markMessagesReadThrough = useCallback(messageId => {
        const target = messagesRef.current.find(item => item.id === messageId);
        if (!target) return;
        const nextUnread = messagesRef.current.find(item => getMessageCursor(item)
            && (item.created_at > target.created_at || (item.created_at === target.created_at && item.id > target.id)));
        if (!nextUnread) {
            markRead();
            return;
        }
        const previous = messagesRef.current.filter(item => item.created_at < nextUnread.created_at
            || (item.created_at === nextUnread.created_at && item.id < nextUnread.id));
        const cursor = getInitialCursor(previous);
        if (!cursor) return;
        clearTimeout(readWriteTimerRef.current);
        readWriteTimerRef.current = setTimeout(() => {
            persistReadCursor(cursor).catch(readError => console.warn('[Intercom] No se pudo guardar lectura:', readError.message));
        }, 350);
    }, [markRead, persistReadCursor]);

    const refresh = useCallback(async () => {
        await fetchLatest();
        await fetchUnreadCount();
    }, [fetchLatest, fetchUnreadCount]);

    useEffect(() => {
        if (!supabaseCloud || !primaryDeviceId || !deviceId) {
            setLoading(false);
            setError(!supabaseCloud ? 'Falta configurar Supabase Cloud.' : 'Falta el vínculo con una caja.');
            return undefined;
        }
        const scope = `${primaryDeviceId}:${deviceId}`;
        if (scopeRef.current !== scope) {
            scopeRef.current = scope;
            initializedRef.current = '';
            messagesRef.current = [];
            readCursorRef.current = null;
            setMessages([]);
            setReadCursor(null);
            setUnreadCount(0);
            setLoading(true);
            setError('');
        }
        let disposed = false;
        const channel = supabaseCloud.channel(`device-messages:${primaryDeviceId}:${deviceId}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'device_messages',
                filter: `primary_device_id=eq.${primaryDeviceId}`,
            }, payload => {
                if (disposed) return;
                const row = payload.new;
                if (row?.primary_device_id !== primaryDeviceId) return;
                const isNew = !messagesRef.current.some(message => message.id === row.id);
                setMergedMessages([row]);
                if (isNew && row.sender_device_id !== deviceId) {
                    setUnreadCount(value => value + 1);
                    onIncomingMessage?.(row);
                }
            })
            .subscribe(status => {
                if (disposed) return;
                if (status === 'SUBSCRIBED') {
                    const initial = initializedRef.current !== scope;
                    initializedRef.current = scope;
                    const task = initial
                        ? Promise.all([fetchReadCursor(), fetchLatest({ initial: true })]).then(([cursor]) => fetchUnreadCount(cursor))
                        : refresh();
                    task.catch(loadError => setError(loadError.message || 'No se pudo sincronizar el chat.'))
                        .finally(() => { if (initial && scopeRef.current === scope) setLoading(false); });
                } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    setError('Se perdió la conexión del chat; se recuperarán los mensajes al reconectar.');
                }
            });
        const onVisible = () => {
            if (document.visibilityState === 'visible') refresh().catch(loadError => setError(loadError.message || 'No se pudo recuperar el chat.'));
        };
        const onWorkerMessage = event => {
            if (event.data?.primaryDeviceId !== primaryDeviceId) return;
            if (event.data?.type === 'INTERCOM_PUSH') refresh().catch(loadError => setError(loadError.message || 'No se pudo recuperar el chat.'));
            if (event.data?.type === 'INTERCOM_OPEN') onOpenPush?.();
        };
        document.addEventListener('visibilitychange', onVisible);
        navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
        return () => {
            disposed = true;
            if (scopeRef.current === scope) scopeRef.current = '';
            document.removeEventListener('visibilitychange', onVisible);
            navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
            clearTimeout(readWriteTimerRef.current);
            supabaseCloud.removeChannel(channel);
        };
    }, [deviceId, fetchLatest, fetchReadCursor, fetchUnreadCount, onIncomingMessage, onOpenPush, persistReadCursor, primaryDeviceId, refresh, setMergedMessages]);

    const persistMessage = useCallback(async row => {
        if (sendInFlightRef.current) throw new Error('Ya se está enviando un mensaje.');
        sendInFlightRef.current = true;
        setSending(true);
        setError('');
        setFailedMessages(previous => previous.filter(message => message.id !== row.id));
        setMergedMessages([{ ...row, delivery_state: 'sending' }]);
        try {
            const { data, error: insertError } = await supabaseCloud.from('device_messages')
                .insert({
                    id: row.id, primary_device_id: row.primary_device_id,
                    sender_device_id: row.sender_device_id, sender_role: row.sender_role,
                    sender_name: row.sender_name, message: row.message,
                })
                .select('id,primary_device_id,sender_device_id,sender_role,sender_name,message,created_at')
                .single();
            if (insertError) {
                if (insertError.code === '42501' || insertError.status === 401 || insertError.status === 403) {
                    throw new Error('Este dispositivo ya no pertenece a un vínculo activo. Vuelve a emparejarlo antes de usar el chat.');
                }
                if (insertError.code !== '23505') throw insertError;
                const { data: existing, error: lookupError } = await supabaseCloud.from('device_messages')
                    .select('id,primary_device_id,sender_device_id,sender_role,sender_name,message,created_at')
                    .eq('id', row.id).single();
                if (lookupError) throw lookupError;
                if (existing.primary_device_id !== row.primary_device_id
                    || existing.sender_device_id !== row.sender_device_id
                    || existing.sender_role !== row.sender_role
                    || existing.sender_name !== row.sender_name
                    || existing.message !== row.message) {
                    throw new Error('El identificador del envío ya existe con otro contenido.');
                }
                setMergedMessages([existing]);
                return existing;
            }
            setMergedMessages([data]);
            return data;
        } catch (sendError) {
            const failed = { ...row, delivery_state: 'failed' };
            setMergedMessages([failed]);
            setFailedMessages(previous => [...previous.filter(message => message.id !== failed.id), failed]);
            setError(sendError.message || 'No se pudo enviar el mensaje.');
            throw sendError;
        } finally {
            sendInFlightRef.current = false;
            setSending(false);
        }
    }, [setMergedMessages]);

    const sendMessage = useCallback(async rawMessage => {
        const validation = validateMessage(rawMessage);
        if (!validation.valid) throw new Error(validation.reason);
        if (!supabaseCloud || !primaryDeviceId || !deviceId) throw new Error('No hay conexión con el chat de Supabase.');
        return persistMessage({
            id: crypto.randomUUID(), primary_device_id: primaryDeviceId,
            sender_device_id: deviceId, sender_role: senderRole,
            sender_name: String(senderName || (senderRole === 'pos' ? 'Caja' : 'Supervisor')).slice(0, 80),
            message: validation.message, created_at: new Date().toISOString(),
        });
    }, [deviceId, persistMessage, primaryDeviceId, senderName, senderRole]);

    const retryMessage = useCallback(messageId => {
        const row = failedMessages.find(message => message.id === messageId);
        if (!row) return Promise.reject(new Error('El mensaje pendiente ya no existe.'));
        return persistMessage(row);
    }, [failedMessages, persistMessage]);

    const enablePush = useCallback(async () => {
        if (!pushSupported()) {
            setPushState('unsupported');
            setError('Tu navegador no soporta notificaciones Push en este dispositivo.');
            return false;
        }
        if (!PUSH_PUBLIC_KEY) {
            setPushState('unconfigured');
            setError('Falta la clave VAPID pública.');
            return false;
        }
        if (!supabaseCloud || !primaryDeviceId || !deviceId) {
            setError('Falta vincular este dispositivo a una caja antes de activar Push.');
            return false;
        }
        setPushBusy(true);
        setError('');
        try {
            let permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';
            if (permission !== 'granted') {
                try {
                    const req = Notification.requestPermission();
                    if (req && typeof req.then === 'function') {
                        permission = await req;
                    } else {
                        permission = await new Promise(resolve => Notification.requestPermission(resolve));
                    }
                } catch {
                    permission = typeof Notification !== 'undefined' ? Notification.permission : 'default';
                }
            }
            if (permission !== 'granted') {
                setPushState('denied');
                setError('Permiso denegado. Toca el candado o configuración del sitio en el navegador para permitir.');
                return false;
            }

            let registration = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
            ]).catch(() => null);

            if (!registration || !registration.active) {
                await navigator.serviceWorker.register('/sw.js').catch(() => null);
                registration = await Promise.race([
                    navigator.serviceWorker.ready,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
                ]).catch(() => null);
            }
            if (!registration) {
                registration = await navigator.serviceWorker.getRegistration().catch(() => null);
            }
            if (!registration?.pushManager) {
                throw new Error('PushManager no está listo en el navegador. Intenta recargar la página.');
            }

            let subscription = await registration.pushManager.getSubscription().catch(() => null);
            if (!subscription) {
                const keyArray = fromBase64Url(PUSH_PUBLIC_KEY);
                try {
                    subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: keyArray,
                    });
                } catch (subErr) {
                    console.warn('[Intercom] pushManager.subscribe falló; se comprobará si la suscripción se completó antes del error:', subErr);
                    // Algunos navegadores pueden completar la suscripción y luego rechazar la promesa.
                    // Reutiliza ese resultado si existe; no la canceles ni repitas subscribe a ciegas.
                    subscription = await registration.pushManager.getSubscription().catch(() => null);
                    if (!subscription) throw subErr;
                }
            }
            const row = buildPushRow({
                primaryDeviceId,
                deviceId,
                subscriptionJson: subscription.toJSON(),
            });
            // El upsert puede chocar con `device_push_subscriptions_endpoint_key` cuando
            // este navegador ya estaba registrado con OTRA identidad de dispositivo;
            // `registerPushSubscription` libera el endpoint antes de reintentar.
            const pushRegistration = await registerPushSubscription({ client: supabaseCloud, row });
            if (!pushRegistration.ok) {
                console.error('[Intercom] No se pudo registrar la suscripción Push:', pushRegistration.path, pushRegistration.error);
                setPushState('error');
                setError(describePushRegistrationFailure(pushRegistration));
                return false;
            }
            setPushState('active');
            return true;
        } catch (pushError) {
            console.error('[Intercom] Error en enablePush:', pushError);
            const msg = pushError.message || 'No se pudieron activar las notificaciones.';
            if (/push service error|registration failed/i.test(msg)) {
                setError('El navegador no pudo crear la suscripción Push. El servicio puede estar temporalmente inaccesible o bloqueado por la red. Comprueba la conexión o VPN y vuelve a intentarlo más tarde.');
            } else {
                setError(msg);
            }
            setPushState('error');
            return false;
        } finally { setPushBusy(false); }
    }, [deviceId, primaryDeviceId]);

    const disablePush = useCallback(async () => {
        if (!pushSupported()) return;
        setPushBusy(true);
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            const endpoint = subscription?.endpoint;
            if (subscription) await subscription.unsubscribe();
            if (endpoint && supabaseCloud) {
                const { error: removeError } = await supabaseCloud.from(PUSH_TABLE).delete()
                    .eq('device_id', deviceId).eq('endpoint', endpoint);
                if (isRlsError(removeError)) {
                    throw new Error('Este dispositivo ya no pertenece a un vínculo activo.');
                }
                if (removeError) throw removeError;
            }
            setPushState('disabled');
        } catch (pushError) {
            setError(pushError.message || 'No se pudieron desactivar las notificaciones.');
            setPushState('error');
        } finally { setPushBusy(false); }
    }, [deviceId]);

    const syncPushState = useCallback(async () => {
        if (!pushSupported()) { setPushState('unsupported'); return; }
        if (!PUSH_PUBLIC_KEY) { setPushState('unconfigured'); return; }
        if (!supabaseCloud || !primaryDeviceId || !deviceId) return;
        try {
            if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
                setPushState('denied');
                return;
            }
            const registration = await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
            ]).catch(() => null);

            let subscription = null;
            if (registration?.pushManager) {
                try {
                    subscription = await registration.pushManager.getSubscription();
                } catch { /* pushManager fallback */ }
            }

            if (!subscription || Notification.permission !== 'granted') {
                try {
                    await supabaseCloud.from(PUSH_TABLE).delete().eq('device_id', deviceId);
                } catch {}
                setPushState(Notification.permission === 'denied' ? 'denied' : 'disabled');
                return;
            }
            const row = buildPushRow({
                primaryDeviceId,
                deviceId,
                subscriptionJson: subscription.toJSON(),
            });
            const pushRegistration = await registerPushSubscription({ client: supabaseCloud, row });
            setPushState(pushRegistration.ok ? 'active' : 'disabled');
        } catch { setPushState('disabled'); }
    }, [deviceId, primaryDeviceId]);

    useEffect(() => { syncPushState(); }, [syncPushState]);
    useEffect(() => () => clearTimeout(readWriteTimerRef.current), []);

    return {
        messages, failedMessages, loading, sending, error, unreadCount, pushState, pushBusy,
        refresh, markRead, markMessageRead, markMessagesReadThrough, sendMessage, retryMessage, enablePush, disablePush,
    };
}
