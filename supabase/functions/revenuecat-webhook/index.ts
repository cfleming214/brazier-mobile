// RevenueCat → Supabase plan sync (DROP-52).
// Configure in RevenueCat: Integrations → Webhooks → URL = <project>/functions/v1/revenuecat-webhook,
// Authorization header = "Bearer $REVENUECAT_WEBHOOK_SECRET".
import { createClient } from 'npm:@supabase/supabase-js@2';
import { planForEvent, type RevenueCatEvent } from './plan.ts';

const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  {
    auth: { persistSession: false },
  },
);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`)
    return new Response('unauthorized', { status: 401 });

  const body = (await req.json().catch(() => null)) as { event?: RevenueCatEvent } | null;
  const event = body?.event;
  if (!event?.app_user_id) return new Response('bad request', { status: 400 });

  const change = planForEvent(event);
  if (!change) return Response.json({ ignored: event.type });

  const { error } = await admin
    .from('profiles')
    .update({
      plan: change.plan,
      plan_expires_at: change.expiresAt,
      revenuecat_app_user_id: event.app_user_id,
    })
    .eq('id', event.app_user_id);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true, plan: change.plan });
});
