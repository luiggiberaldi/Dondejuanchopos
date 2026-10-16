import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Check, LoaderCircle, MessageCircle, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { countCodePoints, INTERCOM_MESSAGE_LIMIT, validateMessage } from '../utils/intercomModel';

function formatTime(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('es-VE', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function IntercomTrigger({ unreadCount, onClick, label = 'Abrir intercomunicador' }) {
    return (
        <button type="button" onClick={onClick} aria-label={label}
            className="fixed bottom-24 right-4 z-[70] flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl ring-4 ring-white/70 transition hover:bg-indigo-700 active:scale-95 dark:ring-slate-900/70">
            <MessageCircle size={24} />
            {unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-6 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-xs font-black text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </button>
    );
}

export default function IntercomModal({
    open,
    onClose,
    chat,
    currentDeviceId,
    pairingAvailable,
    dark = false,
}) {
    const [draft, setDraft] = useState('');
    const [sendError, setSendError] = useState('');
    const [confirmingClear, setConfirmingClear] = useState(false);
    const [clearing, setClearing] = useState(false);
    const listRef = useRef(null);
    const bottomRef = useRef(null);
    const lastMessageRef = useRef(null);
    const [lastMessageVisible, setLastMessageVisible] = useState(false);
    const validation = validateMessage(draft);
    const count = countCodePoints(draft);

    const { markMessageRead, markMessagesReadThrough, messages, pushState, pushBusy, error, loading, refresh, clearConversation, enablePush, disablePush, sending, sendMessage, retryMessage } = chat;

    useEffect(() => {
        if (!open) return undefined;
        const timer = setTimeout(() => {
            const list = listRef.current;
            if (list) list.scrollTop = list.scrollHeight;
            bottomRef.current?.scrollIntoView({ block: 'end' });
        }, 30);
        return () => clearTimeout(timer);
    }, [open, messages.length]);

    useEffect(() => {
        if (!open || !messages.length || !lastMessageRef.current || !('IntersectionObserver' in window)) {
            setLastMessageVisible(false);
            return undefined;
        }
        const observer = new IntersectionObserver(([entry]) => {
            setLastMessageVisible(entry.isIntersecting && entry.intersectionRatio >= 0.8);
        }, { threshold: 0.8 });
        observer.observe(lastMessageRef.current);
        return () => observer.disconnect();
    }, [open, messages.length]);

    useEffect(() => {
        if (!open || !lastMessageVisible) return;
        const latest = messages[messages.length - 1];
        if (latest) markMessagesReadThrough(latest.id);
    }, [lastMessageVisible, markMessagesReadThrough, messages, open]);

    useEffect(() => {
        if (!open) setLastMessageVisible(false);
    }, [open]);

    useEffect(() => {
        if (!open || lastMessageVisible) return;
        const onScroll = () => {
            const node = listRef.current;
            if (!node) return;
            const threshold = 48;
            const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
            if (atBottom) {
                const latest = messages[messages.length - 1];
                if (latest) markMessagesReadThrough(latest.id);
            }
        };
        const node = listRef.current;
        node?.addEventListener('scroll', onScroll, { passive: true });
        return () => node?.removeEventListener('scroll', onScroll);
    }, [lastMessageVisible, markMessagesReadThrough, messages, open]);

    const retrySync = async () => {
        setSendError('');
        try {
            await refresh();
        } catch (refreshError) {
            setSendError(refreshError.message || 'No se pudo recuperar la conversación.');
        }
    };

    const clearMessages = async () => {
        setSendError('');
        setClearing(true);
        try {
            await clearConversation();
            setConfirmingClear(false);
        } catch (clearError) {
            setSendError(clearError.message || 'No se pudo borrar la conversación.');
        } finally {
            setClearing(false);
        }
    };

    const submit = async (event) => {
        event?.preventDefault();
        if (!validation.valid || sending) return;
        setSendError('');
        try {
            const sentMessage = await sendMessage(validation.message);
            setDraft('');
            markMessageRead(sentMessage.id);
            bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
        } catch (error) {
            setSendError(error.message || 'No se pudo enviar. Puedes reintentar.');
        }
    };

    if (!open) return null;
    const shell = dark ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900';
    const muted = dark ? 'text-slate-400' : 'text-slate-500';
    const border = dark ? 'border-slate-800' : 'border-slate-200';

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="intercom-title" className={`flex h-[min(760px,94dvh)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:rounded-3xl ${shell}`}>
                <header className={`flex items-center justify-between border-b px-4 py-3 ${border}`}>
                    <div>
                        <h2 id="intercom-title" className="text-lg font-black">Intercomunicador</h2>
                        <p className={`text-xs ${muted}`}>{pairingAvailable ? 'Caja · Supervisores' : 'Chat de texto'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setConfirmingClear(true)} disabled={!pairingAvailable || clearing || messages.length === 0} className={`rounded-full p-2 hover:bg-slate-500/10 disabled:opacity-40 ${muted}`} aria-label="Borrar mensajes"><Trash2 size={18} /></button>
                        <button type="button" onClick={retrySync} className={`rounded-full p-2 hover:bg-slate-500/10 ${muted}`} aria-label="Sincronizar conversación"><RefreshCw size={18} /></button>
                        <button type="button" onClick={onClose} className={`rounded-full p-2 hover:bg-slate-500/10 ${muted}`} aria-label="Cerrar chat"><X size={20} /></button>
                    </div>
                </header>

                <div className={`flex items-center justify-between border-b px-4 py-2 ${border}`}>
                    <div className={`text-xs ${muted}`} aria-live="polite">{pushState === 'active' ? 'Notificaciones de fondo activas' : pushState === 'unsupported' ? 'Push no disponible en este navegador' : pushState === 'unconfigured' ? 'Push pendiente de configurar' : pushState === 'denied' ? 'Permiso de notificaciones denegado' : 'Notificaciones de fondo desactivadas'}</div>
                    {pushState === 'active' ? (
                        <button type="button" onClick={disablePush} disabled={pushBusy} className={`flex items-center gap-1 text-xs font-bold ${muted}`}><BellOff size={14} /> Desactivar</button>
                    ) : pushState === 'disabled' || pushState === 'denied' || pushState === 'error' ? (
                        <button type="button" onClick={enablePush} disabled={pushBusy} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-50">{pushBusy ? <LoaderCircle className="animate-spin" size={14} /> : <Bell size={14} />} Activar</button>
                    ) : null}
                </div>

                {confirmingClear && (
                    <div role="alertdialog" aria-labelledby="intercom-clear-title" className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-xs ${border} bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200`}>
                        <span id="intercom-clear-title" className="font-bold">¿Borrar todos los mensajes de esta conversación? No se puede deshacer.</span>
                        <span className="flex gap-2">
                            <button type="button" onClick={() => setConfirmingClear(false)} disabled={clearing} className="rounded-lg px-2.5 py-1.5 font-bold hover:bg-slate-500/10 disabled:opacity-50">Cancelar</button>
                            <button type="button" onClick={clearMessages} disabled={clearing} className="flex items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 font-bold text-white disabled:opacity-50">{clearing && <LoaderCircle className="animate-spin" size={14} />} Borrar</button>
                        </span>
                    </div>
                )}
                {!pairingAvailable && <div className="bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Falta vincular este dispositivo a una caja para intercambiar mensajes.</div>}
                {error && <div className="flex items-center justify-between gap-2 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200"><span>{error}</span><button type="button" onClick={retrySync} aria-label="Reintentar sincronización"><RefreshCw size={15} /></button></div>}

                <div className="relative min-h-0 flex-1 flex flex-col overflow-hidden">
                    {/* Marca de agua con el logo principal en el fondo del intercomunicador */}
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 select-none z-0">
                        <img
                            src={dark ? './logodark.png' : './logo.png'}
                            alt=""
                            aria-hidden="true"
                            className="w-[90%] max-w-[440px] max-h-[85%] object-contain opacity-[0.09] dark:opacity-[0.11] filter grayscale-[10%]"
                        />
                    </div>

                    <div ref={listRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
                        {loading ? <div className={`flex h-full items-center justify-center gap-2 text-sm ${muted}`}><LoaderCircle className="animate-spin" size={18} /> Cargando conversación…</div> : messages.length === 0 ? <div className={`flex h-full flex-col items-center justify-center text-center ${muted}`}><MessageCircle size={28} className="mb-2 opacity-60" /><p className="font-bold">Todavía no hay mensajes</p><p className="mt-1 text-xs">Escribe para iniciar la conversación.</p></div> : (
                            <div className="space-y-3">
                                {messages.map((message, index) => {
                                    const own = message.sender_device_id === currentDeviceId;
                                    const isLatest = index === messages.length - 1;
                                    return <article key={message.id} ref={isLatest ? lastMessageRef : undefined} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[86%] rounded-2xl px-3.5 py-2.5 ${own ? 'rounded-br-md bg-indigo-600 text-white' : dark ? 'rounded-bl-md bg-slate-800 text-slate-100' : 'rounded-bl-md bg-slate-100 text-slate-900'}`}>
                                            {!own && <div className="mb-1 text-[11px] font-black opacity-75">{message.sender_name || 'Supervisor'}</div>}
                                            <p className="whitespace-pre-wrap break-words text-sm">{message.message}</p>
                                            <div className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${own ? 'text-indigo-100' : muted}`}>{formatTime(message.created_at)}{own && (message.delivery_state === 'sending' ? <LoaderCircle className="animate-spin" size={12} /> : message.delivery_state === 'failed' ? <button type="button" onClick={() => retryMessage(message.id).catch(retryError => setSendError(retryError.message || 'No se pudo reintentar.'))} className="font-bold underline">Reintentar</button> : <Check size={12} />)}</div>
                                        </div>
                                    </article>;
                                })}
                                <div ref={bottomRef} />
                            </div>
                        )}
                    </div>
                </div>

                <div className={`border-t px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 ${border}`}>
                    <form onSubmit={submit} className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                            <label className="sr-only" htmlFor="intercom-message">Mensaje</label>
                            <textarea id="intercom-message" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) submit(event); }} rows={2} maxLength={640} placeholder="Escribe un mensaje…" disabled={!pairingAvailable || loading} className={`max-h-28 min-h-12 w-full resize-none rounded-2xl border px-3 py-2.5 text-sm outline-none focus:border-indigo-500 ${dark ? 'border-slate-700 bg-slate-900 placeholder:text-slate-500' : 'border-slate-200 bg-slate-50 placeholder:text-slate-400'}`} />
                            <div className={`mt-0.5 text-right text-[10px] ${count > INTERCOM_MESSAGE_LIMIT ? 'text-rose-500' : muted}`}>        {count}/{INTERCOM_MESSAGE_LIMIT}</div>
                        </div>
                        <button type="submit" disabled={!pairingAvailable || !validation.valid || sending} className="mb-5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40" aria-label="Enviar mensaje">{sending ? <LoaderCircle className="animate-spin" size={18} /> : <Send size={18} />}</button>
                    </form>
                    {(sendError || (draft && !validation.valid)) && <p role="alert" className="px-1 text-xs text-rose-500">{sendError || validation.reason}</p>}
                    <p className={`mt-1 text-center text-[10px] ${muted}`}>Solo texto · no usar para autorizar operaciones</p>
                </div>
            </section>
        </div>
    );
}
