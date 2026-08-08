import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/config/supabaseCloud.js', () => ({
    supabaseCloud: {
        storage: {
            from: () => ({
                upload: vi.fn().mockResolvedValue({ error: null }),
                getPublicUrl: vi.fn().mockReturnValue({
                    data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/product-images/d/p.jpg' }
                }),
            }),
        },
    },
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        storage: {
            from: () => ({
                upload: vi.fn().mockResolvedValue({ error: null }),
                getPublicUrl: vi.fn().mockReturnValue({
                    data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/product-images/d/p.jpg' }
                }),
            }),
        },
    },
}));

const VALID_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('imageUpload', () => {
    beforeEach(() => localStorage.clear());

    it('IM-01: devuelve null sin sesión ni device_id', async () => {
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        expect(await uploadProductImage(VALID_B64, { id: 'p1' })).toBeNull();
    });

    it('IM-02: sube cuando dj_device_id está presente (contexto caja)', async () => {
        localStorage.setItem('dj_device_id', 'caja-001');
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        const url = await uploadProductImage(VALID_B64, { id: 'p1' });
        expect(url).toContain('product-images');
    });

    it('IM-03: sube cuando dj_paired_device_id está presente (contexto monitor)', async () => {
        localStorage.setItem('dj_device_id', 'mon-002');
        localStorage.setItem('dj_paired_device_id', 'caja-001');
        const { uploadProductImage } = await import('../src/utils/imageUpload');
        const url = await uploadProductImage(VALID_B64, { id: 'p2' });
        expect(url).toContain('product-images');
    });

    it('IM-04: isStorageImageUrl discrimina URLs de Storage vs base64', async () => {
        const { isStorageImageUrl } = await import('../src/utils/imageUpload');
        expect(isStorageImageUrl('https://x.supabase.co/storage/v1/object/public/product-images/d/p.jpg')).toBe(true);
        expect(isStorageImageUrl(VALID_B64)).toBe(false);
        expect(isStorageImageUrl(null)).toBe(false);
    });
});
