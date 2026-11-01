/** Expo push client (https://docs.expo.dev/push-notifications/sending-notifications/). */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  categoryId?: string;
  channelId?: string;
  interruptionLevel?: 'active' | 'critical' | 'passive' | 'time-sensitive';
  collapseId?: string;
  threadId?: string;
}

export type PushTicket =
  { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

export interface PushClient {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  receipts(
    ids: string[],
  ): Promise<Record<string, { status: 'ok' | 'error'; details?: { error?: string } }>>;
}

export function createPushClient(
  baseUrl: string,
  accessToken?: string,
  fetchImpl: typeof fetch = fetch,
): PushClient {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  return {
    async send(messages) {
      const tickets: PushTicket[] = [];
      for (let i = 0; i < messages.length; i += 100) {
        const res = await fetchImpl(`${baseUrl}/--/api/v2/push/send`, {
          method: 'POST',
          headers,
          body: JSON.stringify(messages.slice(i, i + 100)),
        });
        const json = (await res.json()) as { data: PushTicket[] };
        tickets.push(...json.data);
      }
      return tickets;
    },
    async receipts(ids) {
      if (ids.length === 0) return {};
      const res = await fetchImpl(`${baseUrl}/--/api/v2/push/getReceipts`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ids }),
      });
      return ((await res.json()) as { data: Record<string, { status: 'ok' | 'error' }> }).data;
    },
  };
}
