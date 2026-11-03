/* global http, json, output, ACTION, EMAIL, SUPABASE_URL, SERVICE_KEY, RETAILER, SKU, STATE, PRICE, PROTECTIONS, FAKE_RETAILER_URL, FAKE_PUSH_URL */
// Drives the fake retailer / fake push test doubles from Maestro flows (local + CI only).
//   ACTION=reset                         clear fake retailer SKUs and recorded pushes
//   ACTION=set RETAILER SKU STATE [PRICE] [PROTECTIONS=queue,limit:1]
//   ACTION=pushes                        output.pushCount = number of pushes recorded
//   ACTION=latestWatch EMAIL             output.watchId = newest watch for that user (service key)
var retailerUrl =
  typeof FAKE_RETAILER_URL !== 'undefined' && FAKE_RETAILER_URL
    ? FAKE_RETAILER_URL
    : 'http://localhost:4010';
var pushUrl =
  typeof FAKE_PUSH_URL !== 'undefined' && FAKE_PUSH_URL ? FAKE_PUSH_URL : 'http://localhost:4020';
var headers = { 'content-type': 'application/json' };

function ok(res, what) {
  if (res.status < 200 || res.status >= 300)
    throw new Error(what + ' failed: HTTP ' + res.status + ' ' + res.body);
  return res;
}

if (ACTION === 'reset') {
  ok(http.post(retailerUrl + '/control/reset', { headers: headers, body: '{}' }), 'reset retailer');
  ok(http.request(pushUrl + '/messages', { method: 'DELETE' }), 'reset push');
} else if (ACTION === 'set') {
  var body = {
    state: STATE,
    shipAvailable: STATE === 'IN_STOCK',
    priceCents: typeof PRICE !== 'undefined' && PRICE ? Number(PRICE) : null,
    protections: typeof PROTECTIONS !== 'undefined' && PROTECTIONS ? PROTECTIONS.split(',') : [],
  };
  ok(
    http.post(retailerUrl + '/control/sku/' + RETAILER + '/' + SKU, {
      headers: headers,
      body: JSON.stringify(body),
    }),
    'set sku',
  );
} else if (ACTION === 'pushes') {
  output.pushCount = json(ok(http.get(pushUrl + '/messages'), 'list pushes').body).length;
} else if (ACTION === 'latestWatch') {
  var base =
    typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL ? SUPABASE_URL : 'http://localhost:54321';
  var auth = { apikey: SERVICE_KEY, authorization: 'Bearer ' + SERVICE_KEY };
  var users = json(
    ok(http.get(base + '/auth/v1/admin/users?per_page=200', { headers: auth }), 'list users').body,
  ).users;
  var uid = null;
  for (var i = 0; i < users.length; i++) if (users[i].email === EMAIL) uid = users[i].id;
  if (!uid) throw new Error('No user ' + EMAIL);
  var rows = json(
    ok(
      http.get(
        base + '/rest/v1/watches?select=id&order=created_at.desc&limit=1&user_id=eq.' + uid,
        { headers: auth },
      ),
      'latest watch',
    ).body,
  );
  output.watchId = rows[0].id;
} else {
  throw new Error('Unknown ACTION ' + ACTION);
}
