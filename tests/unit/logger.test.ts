import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../../src/logger.js';

function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({ logLevel: 'info', env: 'test' }, stream);
  return { logger, output: () => lines.join('') };
}

describe('createLogger redaction', () => {
  it('redacts credentials in request headers', () => {
    const { logger, output } = captureLogger();

    logger.info(
      { req: { headers: { authorization: 'Bearer SECRET-KEY', 'profile-key': 'SECRET-PK' } } },
      'incoming',
    );

    expect(output()).not.toContain('SECRET');
    expect(output()).toContain('[REDACTED]');
  });

  it('redacts TikTok tokens and Spark auth codes at top level and one level deep', () => {
    const { logger, output } = captureLogger();

    logger.info(
      {
        authCode: 'SPARK-CODE-1',
        tiktokRequest: { access_token: 'TT-TOKEN', auth_code: 'SPARK-CODE-2' },
        headers: { 'Access-Token': 'TT-TOKEN-2' },
      },
      'calling tiktok',
    );

    expect(output()).not.toMatch(/SPARK-CODE|TT-TOKEN/);
  });

  it('keeps non-secret fields', () => {
    const { logger, output } = captureLogger();

    logger.info({ advertiserId: '7001' }, 'ok');

    expect(output()).toContain('"advertiserId":"7001"');
  });
});
