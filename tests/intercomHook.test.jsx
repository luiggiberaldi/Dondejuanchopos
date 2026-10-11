import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabase = vi.hoisted(() => ({
    channel: vi.fn(),
    removeChannel: vi.fn(),
    from: vi.fn(),
}));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: mockSupabase }));

import { useDeviceIntercom } from '../src/hooks/useDeviceIntercom';

function queryResult(data = [], count = 0, error = null) {
    const query = {
        select: vi.fn((_columns, options) => { query.isCountQuery = Boolean(options?.head && options?.count); return query; }), eq: vi.fn(() => query), neq: vi.fn(() => query),
        is: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
        gt: vi.fn(() => query),
        or: vi.fn(() => query), maybeSingle: vi.fn(async () => ({ data: null, error })),
        upsert: vi.fn(async () => ({ error })),
        update: vi.fn(() => query),
        insert: vi.fn(() => query), single: vi.fn(async () => ({ data: data[0] || null, error })),
        delete: vi.fn(() => query),
        then: (resolve, reject) => Promise.resolve({ data, count: typeof count === 'function' ? count(query.isCountQuery) : count, error }).then(resolve, reject),
    };
    return query;
}

function channelMock() {
    const channel = {
        on: vi.fn((_event, _filter, handler) => { channel.handler = handler; return channel; }),
        subscribe: vi.fn(callback => { queueMicrotask(() => callback('SUBSCRIBED')); return channel; }),
    };
    return channel;
}

beforeEach(() => {
    vi.clearAllMocks();
    const channel =    channelMock();

    mockSupabase.channel.mockReturnValue(channel);
    mockSupabase.removeChannel.mockResolvedValue('ok');
    mockSupabase.from.mockImplementation(() => queryResult());
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
});

describe('useDeviceIntercom', () => {
    it('subscribes before loading history and removes the realtime channel on unmount', async () => {
        const { unmount } = renderHook(() => useDeviceIntercom({
            primaryDeviceId: 'pos-1', deviceId: 'monitor-1', senderRole: 'monitor', senderName: 'Ana',
        }));
        await waitFor(() => expect(mockSupabase.channel).toHaveBeenCalledWith('device-messages:pos-1:monitor-1'));
        await waitFor(() => expect(mockSupabase.from).toHaveBeenCalledWith('device_messages'));
        expect(mockSupabase.channel.mock.results[0].value.subscribe).toHaveBeenCalled();
        unmount();
        expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(1);
    });

    it('loads the latest 30 messages and catch-up starts after the timestamp/ID cursor', async () => {
        const history = [
            { id: 'a', primary_device_id: 'pos-1', sender_device_id: 'monitor-1', sender_role: 'monitor', sender_name: 'Ana', message: 'Primero', created_at: '2026-10-10T10:00:00.000Z' },
            { id: 'b', primary_device_id: 'pos-1', sender_device_id: 'pos-1', sender_role: 'pos', sender_name: 'Caja', message: 'Segundo', created_at: '2026-10-10T10:01:00.000Z' },
        ];
        const queries = [];
        mockSupabase.from.mockImplementation(table => {
            const query = queryResult(table === 'device_messages' ? history : []);
            queries.push({ table, query });
            return query;
        });
        const { result } = renderHook(() => useDeviceIntercom({
            primaryDeviceId: 'pos-1', deviceId: 'monitor-1', senderRole: 'monitor', senderName: 'Ana',
        }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.messages.map(row => row.id)).toEqual(['a', 'b']);
        const historyQuery = queries.find(item => item.table === 'device_messages').query;
        expect(historyQuery.limit).toHaveBeenCalledWith(30);

        await act(async () => { await result.current.refresh(); });
        expect(queries.filter(item => item.table === 'device_messages').some(({ query }) => query.or.mock.calls.some(([filter]) => (
            filter === 'created_at.gt.2026-10-10T10:01:00.000Z,and(created_at.eq.2026-10-10T10:01:00.000Z,id.gt.b)'
        )))).toBe(true);
    });

    it('increments unread only once for a foreign realtime message and leaves own messages quiet', async () => {
        const onIncomingMessage = vi.fn();
        const { result } = renderHook(() => useDeviceIntercom({
            primaryDeviceId: 'pos-1', deviceId: 'monitor-1', senderRole: 'monitor', senderName: 'Ana', onIncomingMessage,
        }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const channel = mockSupabase.channel.mock.results[0].value;
        const incoming = { id: 'incoming-id', primary_device_id: 'pos-1', sender_device_id: 'pos-1', sender_role: 'pos', sender_name: 'Caja', message: '¿Puedes revisar?', created_at: '2026-10-10T10:00:00.000Z' };

        act(() => channel.handler({ new: incoming }));
        act(() => channel.handler({ new: incoming }));
        expect(result.current.unreadCount).toBe(1);
        expect(onIncomingMessage).toHaveBeenCalledTimes(1);
        act(() => channel.handler({ new: { ...incoming, id: 'own-id', sender_device_id: 'monitor-1' } }));
        expect(result.current.unreadCount).toBe(1);
        expect(onIncomingMessage).toHaveBeenCalledTimes(1);
    });

    it('keeps a per-device read cursor and persists it only when the conversation is read', async () => {
        const history = [{ id: 'latest', primary_device_id: 'pos-1', sender_device_id: 'pos-1', sender_role: 'pos', sender_name: 'Caja', message: 'Hola', created_at: '2026-10-10T10:00:00.000Z' }];
        let readsQuery;
        mockSupabase.from.mockImplementation(table => {
            const query = queryResult(table === 'device_messages' ? history : []);
            if (table === 'device_message_reads') readsQuery = query;
            return query;
        });
        const { result } = renderHook(() => useDeviceIntercom({ primaryDeviceId: 'pos-1', deviceId: 'monitor-2', senderRole: 'monitor', senderName: 'Luis' }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(readsQuery.upsert).not.toHaveBeenCalled();
        await act(async () => { result.current.markRead(); });
        await waitFor(() => expect(readsQuery.upsert).toHaveBeenCalledWith(expect.objectContaining({
            primary_device_id: 'pos-1', reader_device_id: 'monitor-2', last_read_message_id: 'latest',
        }), { onConflict: 'primary_device_id,reader_device_id' }));
    });

    it('keeps a new incoming message unread when another message is marked read', async () => {
        const first = { id: 'first', primary_device_id: 'pos-1', sender_device_id: 'pos-1', sender_role: 'pos', sender_name: 'Caja', message: 'Uno', created_at: '2026-10-10T10:00:00.000Z' };
        let unreadCountQuery = 0;
        let readsQuery;
        mockSupabase.from.mockImplementation(table => {
            const query = queryResult(table === 'device_messages' ? [first] : [], isCountQuery => (
                isCountQuery ? (unreadCountQuery++ === 0 ? 1 : 1) : 0
            ));
            if (table === 'device_message_reads') readsQuery = query;
            return query;
        });
        const { result } = renderHook(() => useDeviceIntercom({ primaryDeviceId: 'pos-1', deviceId: 'monitor-1', senderRole: 'monitor', senderName: 'Ana' }));
        await waitFor(() => expect(result.current.unreadCount).toBe(1));
        const channel = mockSupabase.channel.mock.results[0].value;

        act(() => result.current.markRead());
        act(() => channel.handler({ new: {
            id: 'second', primary_device_id: 'pos-1', sender_device_id: 'pos-1', sender_role: 'pos',
            sender_name: 'Caja', message: 'Dos', created_at: '2026-10-10T10:01:00.000Z',
        } }));
        await waitFor(() => expect(readsQuery.upsert).toHaveBeenCalled());
        await waitFor(() => expect(result.current.unreadCount).toBe(1));
    });

    it('does not advance a reader cursor past newer unseen messages', async () => {
        const history = [
            { id: 'one', primary_device_id: 'pos-1', sender_device_id: 'pos-1', sender_role: 'pos', sender_name: 'Caja', message: 'Uno', created_at: '2026-10-10T10:00:00.000Z' },
            { id: 'two', primary_device_id: 'pos-1', sender_device_id: 'monitor-2', sender_role: 'monitor', sender_name: 'Luis', message: 'Dos', created_at: '2026-10-10T10:01:00.000Z' },
            { id: 'three', primary_device_id: 'pos-1', sender_device_id: 'pos-1', sender_role: 'pos', sender_name: 'Caja', message: 'Tres', created_at: '2026-10-10T10:02:00.000Z' },
        ];
        let readsQuery;
        mockSupabase.from.mockImplementation(table => {
            const query = queryResult(table === 'device_messages' ? history : []);
            if (table === 'device_message_reads') readsQuery = query;
            return query;
        });
        const { result } = renderHook(() => useDeviceIntercom({ primaryDeviceId: 'pos-1', deviceId: 'monitor-1', senderRole: 'monitor', senderName: 'Ana' }));
        await waitFor(() => expect(result.current.loading).toBe(false));
        await act(async () => { result.current.markMessagesReadThrough('one'); });
        await waitFor(() => expect(readsQuery.upsert).toHaveBeenCalledWith(expect.objectContaining({
            reader_device_id: 'monitor-1', last_read_message_id: 'one',
        }), { onConflict: 'primary_device_id,reader_device_id' }));
    });

    it('retries a failed send with the same message ID', async () => {
        const row = { id: 'stable-id', primary_device_id: 'pos-1', sender_device_id: 'monitor-1', sender_role: 'monitor', sender_name: 'Ana', message: 'Hola', created_at: '2026-10-10T10:00:00.000Z' };
        let firstInsert = true;
        const insertQuery = {
            insert: vi.fn(() => insertQuery),
            select: vi.fn(() => insertQuery),
            single: vi.fn(async () => firstInsert ? (firstInsert = false, { data: null, error: new Error('offline') }) : ({ data: row, error: null })),
        };
        mockSupabase.from.mockImplementation(table => table === 'device_messages' ? insertQuery : queryResult());
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('stable-id');
        const { result } = renderHook(() => useDeviceIntercom({ primaryDeviceId: 'pos-1', deviceId: 'monitor-1', senderRole: 'monitor', senderName: 'Ana' }));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await expect(result.current.sendMessage('Hola')).rejects.toThrow('offline'); });
        expect(result.current.failedMessages).toHaveLength(1);
        await act(async () => { await result.current.retryMessage('stable-id'); });
        expect(insertQuery.insert.mock.calls.map(call => call[0].id)).toEqual(['stable-id', 'stable-id']);
        expect(result.current.failedMessages).toHaveLength(0);
    });
});
