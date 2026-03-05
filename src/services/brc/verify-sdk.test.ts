// @vitest-environment node
import { describe, it, expect } from 'vitest';

describe('@bsv/sdk imports', () => {
  it('exports core transaction classes', async () => {
    const sdk = await import('@bsv/sdk');
    expect(sdk.Transaction).toBeDefined();
    expect(sdk.Beef).toBeDefined();
  });

  it('exports wallet interfaces', async () => {
    const sdk = await import('@bsv/sdk');
    expect(sdk.ProtoWallet).toBeDefined();
  });

  it('exports auth classes', async () => {
    const sdk = await import('@bsv/sdk');
    expect(sdk.Peer).toBeDefined();
  });

  it('exports certificate classes', async () => {
    const sdk = await import('@bsv/sdk');
    expect(sdk.Certificate).toBeDefined();
  });

  it('exports crypto primitives', async () => {
    const sdk = await import('@bsv/sdk');
    expect(sdk.PrivateKey).toBeDefined();
    expect(sdk.PublicKey).toBeDefined();
    expect(sdk.Hash).toBeDefined();
  });
});
