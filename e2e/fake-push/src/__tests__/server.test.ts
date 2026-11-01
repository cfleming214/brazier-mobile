import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakePush, type RecordedMessage } from '../server';

const forwarded: RecordedMessage[] = [];
const fake = createFakePush((m) => forwarded.push(m));
let base = '';

beforeAll(async () => {
  await new Promise<void>((r) => fake.server.listen(0, r));
  base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => fake.server.close(() => r())));

describe('fake push', () => {
  it('accepts an Expo push batch and records each message', async () => {
    const res = await fetch(`${base}/--/api/v2/push/send`, {
      method: 'POST',
      body: JSON.stringify([
        { to: 'ExponentPushToken[a]', title: 'In stock', priority: 'high' },
        { to: 'ExponentPushToken[b]', title: 'In stock' },
      ]),
    }).then((r) => r.json());
    expect(res.data).toHaveLength(2);
    expect(res.data.every((d: { status: string }) => d.status === 'ok')).toBe(true);
    expect(forwarded).toHaveLength(2);
  });

  it('filters recorded messages by token', async () => {
    const list = await fetch(
      `${base}/messages?to=${encodeURIComponent('ExponentPushToken[a]')}`,
    ).then((r) => r.json());
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('In stock');
  });

  it('rejects messages without a recipient', async () => {
    const res = await fetch(`${base}/--/api/v2/push/send`, {
      method: 'POST',
      body: JSON.stringify({ title: 'x' }),
    }).then((r) => r.json());
    expect(res.data[0].status).toBe('error');
  });

  it('returns ok receipts and can be cleared', async () => {
    const r = await fetch(`${base}/--/api/v2/push/getReceipts`, {
      method: 'POST',
      body: JSON.stringify({ ids: ['x'] }),
    }).then((r) => r.json());
    expect(r.data.x.status).toBe('ok');
    await fetch(`${base}/messages`, { method: 'DELETE' });
    expect(await fetch(`${base}/messages`).then((r) => r.json())).toHaveLength(0);
  });
});
