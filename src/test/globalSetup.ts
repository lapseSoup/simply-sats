// Global setup that runs before test files are discovered
// This ensures globalThis.crypto is set before any modules are loaded

export default async function setup() {
  // Dynamically require the native node:crypto module
  // We need to bypass the vite nodePolyfills plugin which replaces crypto with crypto-browserify
  const nodeCrypto = await import('crypto')

  // Set up Web Crypto API globally using native Node.js webcrypto
  if (nodeCrypto.webcrypto) {
    // Use Object.defineProperty to override the getter-only property
    Object.defineProperty(globalThis, 'crypto', {
      value: nodeCrypto.webcrypto,
      writable: true,
      configurable: true
    })
  }
}
