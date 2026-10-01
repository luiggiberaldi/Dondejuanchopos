import { describe, expect, it } from 'vitest';
import { getCloudRetryDelay, isPermanentCloudError } from '../src/utils/cloudRetry';

describe('cloud retry policy', () => {
    it('backs off transient network/server errors exponentially with bounded jitter', () => {
        expect(getCloudRetryDelay({ status: 503 }, 1, () => 0.5)).toBe(15000);
        expect(getCloudRetryDelay(new TypeError('Failed to fetch'), 2, () => 0.5)).toBe(30000);
        expect(getCloudRetryDelay({ status: 503 }, 20, () => 0.5)).toBe(30 * 60 * 1000);
        expect(getCloudRetryDelay({ status: 503 }, 1, () => 0)).toBe(12000);
        expect(getCloudRetryDelay({ status: 503 }, 1, () => 1)).toBe(18000);
    });

    it.each([
        [{ status: 400 }, true],
        [{ status: 401 }, true],
        [{ status: 403 }, true],
        [{ status: 404 }, true],
        [{ code: '42501' }, true],
        [{ code: '42703' }, true],
        [{ code: '42P01' }, true],
        [{ code: 'P0001' }, true],
        [{ status: 408 }, false],
        [{ status: 425 }, false],
        [{ status: 429 }, false],
        [{ status: 500 }, false],
        [new TypeError('Failed to fetch'), false],
    ])('classifies %j as permanent=%s', (error, expected) => {
        expect(isPermanentCloudError(error)).toBe(expected);
    });

    it('backs off permanent errors from five minutes up to six hours', () => {
        expect(getCloudRetryDelay({ status: 401 }, 1)).toBe(5 * 60 * 1000);
        expect(getCloudRetryDelay({ code: '42501' }, 2)).toBe(10 * 60 * 1000);
        expect(getCloudRetryDelay({ status: 404 }, 20)).toBe(6 * 60 * 60 * 1000);
    });
});
