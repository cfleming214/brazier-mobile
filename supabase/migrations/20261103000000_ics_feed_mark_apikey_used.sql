-- Mark ics_feed's apikey parameter as intentionally unused so the schema lint passes.
-- It must stay in the signature: calendar apps can only pass the anon key in the URL, and
-- PostgREST rejects query parameters the function doesn't declare.

create or replace function public.ics_feed(token text, apikey text default null)
returns "*/*"
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid;
  body text;
begin
  perform ics_feed.apikey; -- checked by the API gateway, not here
  select f.user_id into uid from public.calendar_feeds f where f.token = ics_feed.token;
  if uid is null then
    raise exception 'unknown feed' using errcode = 'PT404';
  end if;
  select string_agg(
    concat_ws(E'\r\n',
      'BEGIN:VEVENT',
      'UID:' || e.id || '@brazier.app',
      'DTSTAMP:' || to_char(e.updated_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTSTART:' || to_char(e.starts_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'DTEND:' || to_char((e.starts_at + interval '30 minutes') at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
      'SUMMARY:' || public.ics_escape(case when e.status = 'rumored' then '[Rumored] ' else '' end || e.title),
      'DESCRIPTION:' || public.ics_escape(
        case when e.is_estimate then 'Estimate based on past restocks. ' else '' end ||
        'Status: ' || e.status || coalesce('. Retailer: ' || r.name, '') || '. brazier://calendar?event=' || e.id),
      'STATUS:' || case e.status when 'confirmed' then 'CONFIRMED' when 'cancelled' then 'CANCELLED' else 'TENTATIVE' end,
      'BEGIN:VALARM', 'TRIGGER:-PT' || coalesce(cf.remind_minutes_before, 15) || 'M', 'ACTION:DISPLAY', 'DESCRIPTION:' || public.ics_escape(e.title), 'END:VALARM',
      'END:VEVENT'),
    E'\r\n' order by e.starts_at)
  into body
  from public.calendar_events e
  left join public.retailers r on r.id = e.retailer_id
  left join public.calendar_follows cf on cf.event_id = e.id and cf.user_id = uid
  where e.published
    and e.starts_at > now() - interval '7 days'
    and (
      cf.user_id is not null
      or e.product_id in (select w.product_id from public.watches w where w.user_id = uid)
    );
  perform set_config('response.headers',
    '[{"Content-Type": "text/calendar; charset=utf-8"}, {"Content-Disposition": "inline; filename=brazier.ics"}, {"Cache-Control": "max-age=900"}]', true);
  return convert_to(concat_ws(E'\r\n', 'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Brazier//Drop Calendar//EN', 'CALSCALE:GREGORIAN',
                   'X-WR-CALNAME:Brazier drops', body, 'END:VCALENDAR') || E'\r\n', 'UTF8');
end;
$$;

