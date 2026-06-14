// Public key JWK for RSA signature verification (RSASSA-PKCS1-v1_5 SHA-256)
// In production, the developer should generate their own RSA key pair,
// put the Private Key on the licensing server (Estación Maestra) and the Public Key JWK here.
export const PUBLIC_KEY_JWK = {
    "kty": "RSA",
    "n": "-Gh3FwCQ0uA4uHjdfnA6JQtVRZ6oG1bS6LDngpmB2AZY4Zbewed9cBVWI_Gh7NOoTcSRfwcqMUE_6IaEYLMgY2J-6vSbfCX3unuTn4ZHk9qKUPtUeBl6xJVHpMh-vGd3cqQiMHUvxEOMKQcOJDJyhf1sVR2ODKnVuVJvsX9-uYuUhLC4DrrrJe56PMW0gJwKnri5a9PEAJs0Ku-GeTbbE-3_gvGgsRaRDI8bgfwfxtussO_JYNM-gqMf8HiMPopNMW05NZQ-BrHIxRHBJRli6Q8ptsP5iH_qw46T7LXdsM0UqGSwxwRTfrxb5T4fgLwIE2rqIyFtJvaFiPRDWnNBjw",
    "e": "AQAB"
};

// Legacy XOR key for backward compatibility
export const XOR_KEY = 'PDA_SEC_2026';

export const encodeToken = (str) => {
    try {
        const xored = str.split('').map((c, i) =>
            String.fromCharCode(
                c.charCodeAt(0) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length)
            )
        ).join('');
        return btoa(unescape(encodeURIComponent(xored)));
    } catch { return str; }
};

export const decodeToken = (encoded) => {
    try {
        const xored = decodeURIComponent(escape(atob(encoded)));
        return xored.split('').map((c, i) =>
            String.fromCharCode(
                c.charCodeAt(0) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length)
            )
        ).join('');
    } catch { return encoded; }
};

/**
 * Verifies if the token has a valid signature.
 * Token format: base64(payload) + "." + base64(signature)
 */
export async function verifyLicenseToken(token) {
    if (!token || !token.includes('.')) {
        return { valid: false, payload: null, isLegacy: true };
    }

    try {
        const parts = token.split('.');
        if (parts.length !== 2) return { valid: false, payload: null };

        const payloadStr = atob(parts[0]);
        const signatureBase64 = parts[1];

        // Convert base64 signature to Uint8Array
        const binarySign = atob(signatureBase64);
        const signatureArr = new Uint8Array(binarySign.length);
        for (let i = 0; i < binarySign.length; i++) {
            signatureArr[i] = binarySign.charCodeAt(i);
        }

        // Convert payload to Uint8Array
        const encoder = new TextEncoder();
        const payloadArr = encoder.encode(payloadStr);

        // Import the public key
        const key = await window.crypto.subtle.importKey(
            "jwk",
            PUBLIC_KEY_JWK,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"]
        );

        // Verify the signature
        const isValid = await window.crypto.subtle.verify(
            "RSASSA-PKCS1-v1_5",
            key,
            signatureArr,
            payloadArr
        );

        if (isValid) {
            return { valid: true, payload: JSON.parse(payloadStr) };
        }
    } catch (e) {
        console.error('[License Crypto] Verification failed:', e);
    }

    return { valid: false, payload: null };
}
