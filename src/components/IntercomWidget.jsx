import { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from './Toast';
import { soundService } from '../utils/soundService';
import { useDeviceIntercom } from '../hooks/useDeviceIntercom';
import { IntercomTrigger } from './IntercomModal';
import IntercomModal from './IntercomModal';

export default function IntercomWidget({ primaryDeviceId, deviceId, senderRole, senderName, dark = false }) {
    const [open, setOpen] = useState(() => new URLSearchParams(window.location.search).get('intercom') === '1');
    const openRef = useRef(open);
    useEffect(() => { openRef.current = open; }, [open]);
    const openFromPush = useCallback(() => setOpen(true), []);
    const notifyIncomingMessage = useCallback(message => {
        if (openRef.current) return;
        showToast(`${message.sender_name || 'Supervisor'} te envió un mensaje`, 'info');
        if (window.localStorage.getItem('dj_sound_enabled') !== 'false') {
            soundService.playAlert();
            navigator.vibrate?.(30);
        }
    }, []);
    const chat = useDeviceIntercom({ primaryDeviceId, deviceId, senderRole, senderName, onOpenPush: openFromPush, onIncomingMessage: notifyIncomingMessage });
    const pairingAvailable = Boolean(primaryDeviceId && deviceId);

    useEffect(() => {
        if (!primaryDeviceId) return;
        const url = new URL(window.location.href);
        if (url.searchParams.get('conversation') === primaryDeviceId) return;
        url.searchParams.set('conversation', primaryDeviceId);
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }, [primaryDeviceId]);
    const onTrigger = () => setOpen(true);

    return (
        <>
            <IntercomTrigger unreadCount={chat.unreadCount} onClick={onTrigger} />
            <IntercomModal open={open} onClose={() => setOpen(false)} chat={chat}
                currentDeviceId={deviceId} pairingAvailable={pairingAvailable} dark={dark} />
        </>
    );
}
