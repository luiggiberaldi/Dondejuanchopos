import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IntercomModal from '../src/components/IntercomModal';

afterEach(() => {
    cleanup();
    delete globalThis.IntersectionObserver;
});

function renderChat(overrides = {}) {
    const chat = {
        markRead: vi.fn(),
        markMessageRead: vi.fn(),
        markMessagesReadThrough: vi.fn(),
        messages: [],
        pushState: 'unconfigured',
        pushBusy: false,
        error: '',
        loading: false,
        refresh: vi.fn(),
        enablePush: vi.fn(),
        disablePush: vi.fn(),
        sending: false,
        sendMessage: vi.fn(async () => ({ id: 'sent-id' })),
        retryMessage: vi.fn(async () => ({})),
        clearConversation: vi.fn(async () => {}),
        ...overrides,
    };
    render(
        <IntercomModal
            open
            onClose={vi.fn()}
            chat={chat}
            currentDeviceId="monitor-1"
            pairingAvailable
        />,
    );
    return chat;
}

function installIntersectionObserver() {
    const observers = [];
    globalThis.IntersectionObserver = class {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(target) { this.target = target; }
        disconnect() {}
        trigger(isIntersecting, intersectionRatio = 1) {
            act(() => this.callback([{ isIntersecting, intersectionRatio, target: this.target }]));
        }
    };
    return observers;
}

describe('IntercomModal', () => {
    it('does not show suggested messages', () => {
        renderChat();
        expect(screen.queryByText('Necesito sencillo')).toBeNull();
        expect(screen.queryByText('¿Puedes revisar el precio?')).toBeNull();
        expect(screen.queryByText('Voy a caja')).toBeNull();
    });

    it('lets the user type and send a message from the conversation composer', async () => {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
        const chat = renderChat();
        const composer = screen.getByRole('textbox', { name: 'Mensaje' });
        fireEvent.change(composer, { target: { value: '  Hola, caja  ' } });

        expect(screen.getByText('14/160')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));

        await waitFor(() => expect(chat.sendMessage).toHaveBeenCalledWith('Hola, caja'));
        await waitFor(() => expect(composer.value).toBe(''));
        expect(chat.markMessageRead).toHaveBeenCalledWith('sent-id');
    });

    it('asks for confirmation before clearing the conversation', async () => {
        const chat = renderChat({
            messages: [{ id: 'm1', sender_device_id: 'pos-1', sender_name: 'Caja', message: 'Hola', created_at: '2026-10-10T10:00:00Z' }],
        });
        fireEvent.click(screen.getByRole('button', { name: 'Borrar mensajes' }));
        expect(chat.clearConversation).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
        expect(chat.clearConversation).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Borrar mensajes' }));
        fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
        await waitFor(() => expect(chat.clearConversation).toHaveBeenCalledTimes(1));
    });

    it('shows a useful error if retrying chat synchronization fails', async () => {
        const chat = renderChat({ refresh: vi.fn().mockRejectedValue(new Error('No hay conexión.')) });
        fireEvent.click(screen.getByRole('button', { name: 'Sincronizar conversación' }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('No hay conexión.'));
    });

    it('blocks blank and over-limit text in the visible composer', () => {
        renderChat();
        const composer = screen.getByRole('textbox', { name: 'Mensaje' });
        expect(screen.getByRole('button', { name: 'Enviar mensaje' }).disabled).toBe(true);

        fireEvent.change(composer, { target: { value: '🙂'.repeat(161) } });
        expect(screen.getByText('161/160')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('Máximo 160 caracteres.');
        expect(screen.getByRole('button', { name: 'Enviar mensaje' }).disabled).toBe(true);
    });

    it('does not clear unseen messages when only the latest message is visible', async () => {
        const observers = installIntersectionObserver();
        const chat = renderChat({
            messages: [
                { id: 'old', sender_device_id: 'pos-1', sender_name: 'Caja', message: 'Anterior', created_at: '2026-10-10T10:00:00Z' },
                { id: 'latest', sender_device_id: 'pos-1', sender_name: 'Caja', message: 'Nuevo', created_at: '2026-10-10T10:01:00Z' },
            ],
        });
        expect(chat.markRead).not.toHaveBeenCalled();
        observers.at(-1).trigger(true);
        await waitFor(() => expect(chat.markMessagesReadThrough).toHaveBeenCalledWith('latest'));
        expect(chat.markRead).not.toHaveBeenCalled();
    });

    it('marks an empty conversation read through the scroll fallback and marks only the sent row after sending', async () => {
        const chat = renderChat();
        const list = document.querySelector('[aria-live="polite"]');
        Object.defineProperties(list, {
            scrollHeight: { configurable: true, value: 500 },
            clientHeight: { configurable: true, value: 400 },
        });
        list.scrollTop = 100;
        fireEvent.scroll(list);
        expect(chat.markMessagesReadThrough).not.toHaveBeenCalled();
        list.scrollTop = 100;
        Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 400 });
        fireEvent.scroll(list);
        expect(chat.markMessagesReadThrough).not.toHaveBeenCalled();

        fireEvent.change(screen.getByRole('textbox', { name: 'Mensaje' }), { target: { value: 'Hola' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enviar mensaje' }));
        await waitFor(() => expect(chat.markMessageRead).toHaveBeenCalledWith('sent-id'));
        expect(chat.markMessagesReadThrough).not.toHaveBeenCalled();
    });
});
