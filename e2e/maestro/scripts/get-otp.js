/* global http, json, output, EMAIL, MAILPIT_URL */
// Reads the newest sign-in email for EMAIL from the local Mailpit inbox (supabase start)
// and exposes the 6-digit code as output.otp. Local/CI only: production has no inbox to read.
var base =
  typeof MAILPIT_URL !== 'undefined' && MAILPIT_URL ? MAILPIT_URL : 'http://localhost:54324';
var found = null;
for (var i = 0; i < 20 && !found; i++) {
  var res = http.get(base + '/api/v1/search?query=' + encodeURIComponent('to:' + EMAIL));
  var list = json(res.body).messages || [];
  if (list.length > 0) {
    var msg = json(http.get(base + '/api/v1/message/' + list[0].ID).body);
    var m = /code in the app:\s*(?:<strong>)?\s*(\d{6})/.exec(msg.HTML || msg.Text || '');
    if (m) found = m[1];
  }
}
if (!found) throw new Error('No sign-in code found for ' + EMAIL);
output.otp = found;
