import { describe, expect, it } from 'vitest';

import { hashSecret, maskSecret, redactSecrets } from '../../src/lib/secrets.js';

describe('secrets', () => {
  it('hashes deterministically with SHA-256', () => {
    expect(hashSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it.each([
    ['SPARK-CODE-1234', '****1234'],
    ['abcd', '****'],
    ['', '****'],
  ])('masks %j as %j', (input, expected) => {
    expect(maskSecret(input)).toBe(expected);
  });

  it('masks credential-named fields at any depth, in any naming style', () => {
    expect(
      redactSecrets({
        authCode: 'SPARK-CODE-1234',
        nested: {
          access_token: 'tok-5678',
          'Access-Token': 'tok-0000',
          items: [{ apiKey: 'k-9999' }],
        },
        Profile_Key: 'pk-4321',
        advertiserId: '7100',
        at: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toEqual({
      authCode: '****1234',
      nested: {
        access_token: '****5678',
        'Access-Token': '****0000',
        items: [{ apiKey: '****9999' }],
      },
      Profile_Key: '****4321',
      advertiserId: '7100',
      at: '2026-01-01T00:00:00.000Z',
    });
  });
});
