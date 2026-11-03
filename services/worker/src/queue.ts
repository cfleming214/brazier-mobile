import type { SupabaseClient } from '@supabase/supabase-js';

export interface QueueMessage<T> {
  id: bigint | number;
  readCount: number;
  body: T;
}

/** Minimal queue contract so pgmq can be swapped for Kafka later (BUILD_PLAN section 2). */
export interface Queue {
  send<T>(queue: string, body: T, delaySeconds?: number): Promise<void>;
  read<T>(queue: string, max: number, visibilitySeconds?: number): Promise<QueueMessage<T>[]>;
  ack(queue: string, id: QueueMessage<unknown>['id']): Promise<void>;
}

export const MAX_ATTEMPTS = 5;

/** pgmq via service-role-only RPC wrappers (supabase/migrations/..._detection.sql). */
export class PgmqQueue implements Queue {
  constructor(private db: SupabaseClient) {}
  async send<T>(queue: string, body: T, delaySeconds = 0) {
    const { error } = await this.db.rpc('queue_send', {
      queue_name: queue,
      message: body,
      delay_seconds: delaySeconds,
    });
    if (error) throw error;
  }
  async read<T>(queue: string, max: number, visibilitySeconds = 30) {
    const { data, error } = await this.db.rpc('queue_read', {
      queue_name: queue,
      visibility_seconds: visibilitySeconds,
      max_messages: max,
    });
    if (error) throw error;
    return ((data ?? []) as { msg_id: number; read_ct: number; message: T }[]).map((m) => ({
      id: m.msg_id,
      readCount: m.read_ct,
      body: m.message,
    }));
  }
  async ack(queue: string, id: QueueMessage<unknown>['id']) {
    const { error } = await this.db.rpc('queue_delete', {
      queue_name: queue,
      message_id: Number(id),
    });
    if (error) throw error;
  }
}

/** In-memory queue for unit tests. */
export class MemoryQueue implements Queue {
  private seq = 0;
  readonly queues = new Map<
    string,
    { id: number; readCount: number; body: unknown; visibleAt: number }[]
  >();
  constructor(private now: () => number = Date.now) {}
  async send<T>(queue: string, body: T, delaySeconds = 0) {
    const q = this.queues.get(queue) ?? [];
    q.push({ id: ++this.seq, readCount: 0, body, visibleAt: this.now() + delaySeconds * 1000 });
    this.queues.set(queue, q);
  }
  async read<T>(queue: string, max: number, visibilitySeconds = 30) {
    const q = this.queues.get(queue) ?? [];
    const out: QueueMessage<T>[] = [];
    for (const m of q) {
      if (out.length >= max) break;
      if (m.visibleAt > this.now()) continue;
      m.readCount++;
      m.visibleAt = this.now() + visibilitySeconds * 1000;
      out.push({ id: m.id, readCount: m.readCount, body: m.body as T });
    }
    return out;
  }
  async ack(queue: string, id: QueueMessage<unknown>['id']) {
    this.queues.set(
      queue,
      (this.queues.get(queue) ?? []).filter((m) => m.id !== id),
    );
  }
}

/**
 * Process a batch: ack on success, move to dead_letter after MAX_ATTEMPTS failures,
 * otherwise leave it to become visible again for a retry.
 */
export async function drain<T>(
  q: Queue,
  queue: string,
  max: number,
  handle: (body: T) => Promise<void>,
) {
  const msgs = await q.read<T>(queue, max);
  let ok = 0;
  let failed = 0;
  for (const m of msgs) {
    try {
      await handle(m.body);
      await q.ack(queue, m.id);
      ok++;
    } catch (e) {
      failed++;
      if (m.readCount >= MAX_ATTEMPTS) {
        await q.send('dead_letter', {
          queue,
          body: m.body,
          error: e instanceof Error ? e.message : String(e),
        });
        await q.ack(queue, m.id);
      }
    }
  }
  return { ok, failed };
}
