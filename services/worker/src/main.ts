import { createServer } from 'node:http';
import type { RetailerPolicy, RetailerSlug } from '@drophawk/shared';
import { buildAdapters } from './adapters/registry';
import { loadConfig } from './config';
import { createServiceClient } from './db';
import { RetailerGovernor } from './governor';
import { Notifier } from './notifier';
import { Poller } from './poller';
import { createPushClient } from './push';
import { createJobs } from './jobs';
import { handleLead, parseInboundEmail } from './leads';

async function main() {
  const config = loadConfig();
  const db = createServiceClient(config);
  const { data: retailers, error } = await db.from('retailers').select('id, policy');
  if (error) throw error;
  const policies = new Map<RetailerSlug, RetailerPolicy>(
    (retailers ?? []).map((r) => [r.id as RetailerSlug, r.policy as RetailerPolicy]),
  );

  const adapters = buildAdapters(config, policies, { userAgent: config.USER_AGENT, fetch });
  const governors = new Map(
    [...adapters].map(([slug, a]) => [slug, new RetailerGovernor(a.policy)] as const),
  );
  const notifier = new Notifier(
    db,
    createPushClient(config.EXPO_PUSH_URL, config.EXPO_ACCESS_TOKEN),
  );
  const poller = new Poller({
    db,
    adapters,
    governors,
    notifier,
    // Compressing poll intervals is only honoured against the fake retailer, never real stores.
    intervalScale: config.FAKE_RETAILER_URL ? config.POLL_INTERVAL_SCALE : 1,
  });
  const jobs = createJobs({ config, db, notifier, adapters: [...adapters.values()] });

  // Health and metrics endpoint (used by the latency test and E2E tier assertions).
  createServer(async (req, res) => {
    if (req.url === '/health') return res.writeHead(200).end('ok');
    // Inbound newsletter webhook (Postmark or SES-style JSON). Leads only trigger a verifying poll.
    if (req.method === 'POST' && req.url === '/inbound/email') {
      if (!config.INBOUND_SECRET || req.headers['x-inbound-secret'] !== config.INBOUND_SECRET)
        return res.writeHead(401).end();
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const m = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, string>;
      const email = {
        from: m.From ?? m.from ?? '',
        subject: m.Subject ?? m.subject ?? '',
        text: m.TextBody ?? m.text,
        html: m.HtmlBody ?? m.html,
      };
      const result = await handleLead(
        db,
        'email',
        parseInboundEmail(email),
        `${email.subject} ${email.text ?? ''}`,
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(result));
    }
    if (req.url === '/metrics') {
      const { data: tiers } = await db
        .from('retailer_skus')
        .select('retailer_id, retailer_sku, poll_tier, last_state');
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...poller.metrics.snapshot(), tiers }));
    }
    res.writeHead(404).end();
  }).listen(config.METRICS_PORT);

  let stopping = false;
  process.on('SIGTERM', () => (stopping = true));
  process.on('SIGINT', () => (stopping = true));
  let lastFlush = 0;
  console.log(
    `worker started: ${adapters.size} adapters, tick ${config.TICK_MS}ms${config.FAKE_RETAILER_URL ? ' (fake retailer)' : ''}`,
  );
  while (!stopping) {
    const started = Date.now();
    try {
      await poller.tick();
      await jobs.tick();
      if (Date.now() - lastFlush > 5000) {
        await poller.flushTelemetry();
        lastFlush = Date.now();
      }
    } catch (e) {
      console.error('tick failed', e);
    }
    await new Promise((r) => setTimeout(r, Math.max(50, config.TICK_MS - (Date.now() - started))));
  }
  await db
    .from('system_metrics')
    .upsert({ key: 'poller', value: { online: false }, updated_at: new Date().toISOString() });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
