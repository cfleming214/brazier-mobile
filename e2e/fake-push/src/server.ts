import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

/**
 * Expo-Push-compatible endpoint for tests. The worker points EXPO_PUSH_URL here in local and CI
 * runs. Every message is recorded and returned from GET /messages; an optional `onMessage`
 * hook lets the host forward it to a simulator (scripts/forward-push.ts).
 */

export interface ExpoPushMessage {
  to: string | string[];
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
  categoryId?: string;
  interruptionLevel?: string;
  collapseId?: string;
  threadId?: string;
}

export interface RecordedMessage extends ExpoPushMessage {
  id: string;
  receivedAt: string;
}

export function createFakePush(onMessage?: (m: RecordedMessage) => void) {
  const messages: RecordedMessage[] = [];

  async function readJson(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/health') return send(res, 200, { ok: true });

      // Same path as https://exp.host/--/api/v2/push/send
      if (req.method === 'POST' && url.pathname === '/--/api/v2/push/send') {
        const body = await readJson(req);
        const list = (Array.isArray(body) ? body : [body]) as ExpoPushMessage[];
        const data = list.map((m) => {
          if (!m || !m.to) return { status: 'error', message: '"to" is required' };
          const rec: RecordedMessage = {
            ...m,
            id: randomUUID(),
            receivedAt: new Date().toISOString(),
          };
          messages.push(rec);
          onMessage?.(rec);
          return { status: 'ok', id: rec.id };
        });
        return send(res, 200, { data });
      }

      if (req.method === 'POST' && url.pathname === '/--/api/v2/push/getReceipts') {
        const body = (await readJson(req)) as { ids?: string[] } | null;
        const receipts = Object.fromEntries((body?.ids ?? []).map((id) => [id, { status: 'ok' }]));
        return send(res, 200, { data: receipts });
      }

      if (req.method === 'GET' && url.pathname === '/messages') {
        const to = url.searchParams.get('to');
        return send(
          res,
          200,
          to
            ? messages.filter((m) => (Array.isArray(m.to) ? m.to.includes(to) : m.to === to))
            : messages,
        );
      }

      if (req.method === 'DELETE' && url.pathname === '/messages') {
        messages.length = 0;
        return send(res, 200, { ok: true });
      }

      return send(res, 404, { error: 'not found' });
    } catch (e) {
      return send(res, 400, { error: e instanceof Error ? e.message : 'bad request' });
    }
  });

  return { server, messages };
}
