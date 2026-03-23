/**
 * CSPRNG nonce generation for content boundaries.
 * Uses Web Crypto API for cryptographically secure random bytes.
 */

/** Generate a 16-byte hex nonce using CSPRNG. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
