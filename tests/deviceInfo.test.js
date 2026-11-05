import { describe, expect, it } from 'vitest';
import { describeDevice, detectDeviceInfo, parseUserAgent, platformKind } from '../src/utils/deviceInfo';

const UA = {
    pixel: 'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
    reduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
};

describe('parseUserAgent', () => {
    it('reads Android version and model', () => {
        expect(parseUserAgent(UA.pixel)).toEqual({ platform: 'Android', version: '16', model: 'Pixel 10' });
    });
    it('drops the generic "K" model of the reduced user agent', () => {
        expect(parseUserAgent(UA.reduced).model).toBe('');
    });
    it('detects Windows, iPhone and Linux', () => {
        expect(parseUserAgent(UA.windows).platform).toBe('Windows');
        expect(parseUserAgent(UA.iphone)).toMatchObject({ platform: 'iOS', version: '18', model: 'iPhone' });
        expect(parseUserAgent(UA.linux).platform).toBe('Linux');
    });
});

describe('detectDeviceInfo', () => {
    it('prefers client hints for the real model', async () => {
        const nav = {
            userAgent: UA.reduced,
            userAgentData: { getHighEntropyValues: async () => ({ platform: 'Android', model: 'SM-A325M', platformVersion: '14.0.0' }) },
        };
        await expect(detectDeviceInfo(nav)).resolves.toMatchObject({ platform: 'Android 14', model: 'SM-A325M' });
    });
    it('maps Windows platformVersion to Windows 11', async () => {
        const nav = {
            userAgent: UA.windows,
            userAgentData: { getHighEntropyValues: async () => ({ platform: 'Windows', model: '', platformVersion: '15.0.0' }) },
        };
        await expect(detectDeviceInfo(nav)).resolves.toMatchObject({ platform: 'Windows 11', model: '' });
    });
    it('falls back to the user agent without client hints', async () => {
        await expect(detectDeviceInfo({ userAgent: UA.iphone })).resolves.toMatchObject({ platform: 'iOS 18', model: 'iPhone' });
    });
});

describe('describeDevice', () => {
    it('uses reported columns first', () => {
        expect(describeDevice({ device_platform: 'Android 14', device_model: 'SM-A325M', user_agent: UA.reduced }))
            .toMatchObject({ summary: 'Android 14 · SM-A325M', kind: 'android' });
    });
    it('falls back to the stored user agent for devices not yet updated', () => {
        expect(describeDevice({ user_agent: UA.pixel }).summary).toBe('Android 16 · Pixel 10');
        expect(describeDevice({ user_agent: UA.windows })).toMatchObject({ summary: 'Windows', kind: 'windows' });
    });
    it('maps platform kinds', () => {
        expect(platformKind('macOS 15')).toBe('mac');
        expect(platformKind('')).toBe('other');
    });
});
