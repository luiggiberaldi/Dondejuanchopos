import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IntercomModal from '../src/components/IntercomModal';
import { canEditMessage, INTERCOM_EDIT_WINDOW_MS } from '../src/utils/intercomModel';

afterEach(cleanup);

const NOW = Date.parse('2026-11-05T20:00:00Z');
const own = (overrides = {}) => ({
    id: 'm1', primary_device_id: 'pos-1', sender_device_id: 'monitor-1', sender_role: 'monitor',
    sender_name: 'Luigi', message: 'Hola equipo', created_at: new Date(NOW - 60_000).toISOString(), ...overrides,
});

describe('canEditMessage', () => {
    it('allows own saved messages within 15 minutes', () => {
        expect(canEditMessage(own(), 'monitor-1', NOW)).toBe(true);
        expect(canEditMessage(own({ created_at: new Date(NOW - INTERCOM_EDIT_WINDOW_MS).toISOString() }), 'monitor-1', NOW)).toBe(true);
    });
    it('rejects other senders, expired, sending and failed messages', () => {
        expect(canEditMessage(own(), 'monitor-2', NOW)).toBe(false);
        expect(canEditMessage(own({ created_at: new Date(NOW - INTERCOM_EDIT_WINDOW_MS - 1000).toISOString() }), 'monitor-1', NOW)).toBe(false);
        expect(canEditMessage(own({ delivery_state: 'sending' }), 'monitor-1', NOW)).toBe(false);
        expect(canEditMessage(own({ delivery_state: 'failed' }), 'monitor-1', NOW)).toBe(false);
    });
});

function renderChat(messages, overrides = {}) {
    const chat = {
        markRead: vi.fn(), markMessageRead: vi.fn(), markMessagesReadThrough: vi.fn(),
        messages, pushState: 'unconfigured', pushBusy: false, error: '', loading: false,
        refresh: vi.fn(), enablePush: vi.fn(), disablePush: vi.fn(), sending: false,
        sendMessage: vi.fn(async () => ({ id: 'sent-id' })), retryMessage: vi.fn(),
        clearConversation: vi.fn(), editMessage: vi.fn(async () => ({})),
        ...overrides,
    };
    render(<IntercomModal open onClose={vi.fn()} chat={chat} currentDeviceId="monitor-1" pairingAvailable />);
    return chat;
}

describe('IntercomModal edit flow', () => {
    it('edits an own recent message and does not send a new one', async () => {
        const chat = renderChat([own({ created_at: new Date().toISOString() })]);
        fireEvent.click(screen.getByRole('button', { name: 'Editar mensaje' }));
        expect(screen.getByText('Editando mensaje')).toBeTruthy();
        const field = screen.getByLabelText('Mensaje');
        expect(field.value).toBe('Hola equipo');
        fireEvent.change(field, { target: { value: 'Hola equipo, ya llegué' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar edición' }));
        await waitFor(() => expect(chat.editMessage).toHaveBeenCalledWith('m1', 'Hola equipo, ya llegué'));
        expect(chat.sendMessage).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByText('Editando mensaje')).toBeNull());
    });

    it('cancels editing with Escape', () => {
        renderChat([own({ created_at: new Date().toISOString() })]);
        fireEvent.click(screen.getByRole('button', { name: 'Editar mensaje' }));
        fireEvent.keyDown(screen.getByLabelText('Mensaje'), { key: 'Escape' });
        expect(screen.queryByText('Editando mensaje')).toBeNull();
        expect(screen.getByLabelText('Mensaje').value).toBe('');
    });

    it('hides the edit button for other people and old messages, and shows "Editado"', () => {
        renderChat([
            own({ id: 'old', created_at: new Date(Date.now() - 20 * 60_000).toISOString(), edited_at: new Date().toISOString() }),
            own({ id: 'other', sender_device_id: 'pos-1', sender_role: 'pos', sender_name: 'Caja', created_at: new Date().toISOString() }),
        ]);
        expect(screen.queryByRole('button', { name: 'Editar mensaje' })).toBeNull();
        expect(screen.getByText('Editado')).toBeTruthy();
    });
});
