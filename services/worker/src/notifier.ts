import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushClient, PushMessage } from './push';
import { decideDelivery, DEFAULT_PREFS, type Category, type Prefs } from './rules';

export interface NotifyInput {
  userId: string;
  category: Category;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  timeSensitive?: boolean;
  /** Notifications with the same collapse key replace each other on the device. */
  collapseKey?: string;
  /** Prevents duplicates: one notification per user per dedupe key. */
  dedupeKey?: string;
  categoryId?: string;
}

export interface NotifyResult {
  notificationId: string | null;
  delivery: string;
  pushed: number;
}

/**
 * Write the inbox row, apply notification settings, then push to every device the user has.
 * Shared by restock alerts, bot status, drop updates and protection changes.
 */
export class Notifier {
  constructor(
    private db: SupabaseClient,
    private push: PushClient,
    private now: () => Date = () => new Date(),
  ) {}

  private async prefs(userId: string): Promise<Prefs> {
    const { data } = await this.db
      .from('notification_prefs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    return { ...DEFAULT_PREFS, ...(data ?? {}) } as Prefs;
  }

  async notify(n: NotifyInput): Promise<NotifyResult> {
    const prefs = await this.prefs(n.userId);
    const delivery = decideDelivery(prefs, n.category, n.timeSensitive ?? false, this.now());

    const { data: row, error } = await this.db
      .from('notifications')
      .insert({
        user_id: n.userId,
        category: n.category,
        title: n.title,
        body: n.body,
        data: n.data ?? {},
        time_sensitive: n.timeSensitive ?? false,
        collapse_key: n.collapseKey ?? null,
        dedupe_key: n.dedupeKey ?? null,
        push_status: delivery === 'send' ? 'pending' : delivery,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') return { notificationId: null, delivery: 'duplicate', pushed: 0 };
      throw error;
    }
    if (delivery !== 'send') return { notificationId: row.id, delivery, pushed: 0 };

    const { data: tokens } = await this.db
      .from('push_tokens')
      .select('expo_token')
      .eq('user_id', n.userId);
    if (!tokens?.length) {
      await this.db.from('notifications').update({ push_status: 'no_token' }).eq('id', row.id);
      return { notificationId: row.id, delivery: 'no_token', pushed: 0 };
    }

    const messages: PushMessage[] = tokens.map((t) => ({
      to: t.expo_token,
      title: n.title,
      body: n.body,
      data: { ...n.data, notificationId: row.id, category: n.category },
      sound: 'default',
      priority: n.timeSensitive ? 'high' : 'default',
      interruptionLevel: n.timeSensitive ? 'time-sensitive' : 'active',
      categoryId: n.categoryId,
      channelId: n.category,
      collapseId: n.collapseKey,
      threadId: n.collapseKey,
    }));
    const tickets = await this.push.send(messages);
    const dead = tickets
      .map((t, i) =>
        t.status === 'error' && t.details?.error === 'DeviceNotRegistered' ? messages[i]!.to : null,
      )
      .filter((x): x is string => !!x);
    if (dead.length) await this.db.from('push_tokens').delete().in('expo_token', dead);
    const ok = tickets.filter((t) => t.status === 'ok').length;
    await this.db
      .from('notifications')
      .update({ push_status: ok > 0 ? 'sent' : 'failed' })
      .eq('id', row.id);
    return { notificationId: row.id, delivery: ok > 0 ? 'sent' : 'failed', pushed: ok };
  }
}
