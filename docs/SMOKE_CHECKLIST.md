# Pre-release real-device smoke checklist (DROP-65)

Run before every beta and production release, on **one iPhone (TestFlight)** and **one Android
phone (Play internal track)**, against production Supabase with real APNs/FCM. Copy this list into
the release ticket and tick each box. Any failure blocks the release.

Build: `__________`  Channel: `beta / production`  Tester: `__________`  Date: `__________`

## 1. Install and sign in
- [ ] Fresh install launches to the sign-in screen in under 3 s
- [ ] Magic-link email arrives; tapping it opens the app signed in
- [ ] The 6-digit code also works (sign out, sign in with code)

## 2. Notifications permission
- [ ] Permission prompt appears after sign-in; allow it
- [ ] Profile → alert permission gate shows no warning
- [ ] Deny on the second device: Radar shows the "alerts are off" banner with a Settings link

## 3. Add a watch
- [ ] Search "Prismatic Evolutions" → add with all retailers → appears on Radar under Monitoring
- [ ] Paste a Best Buy product link → resolves to the right product
- [ ] Scan a sealed product barcode → resolves or is sent for review

## 4. Real push delivery (use the ops "send test restock" action or a staging SKU)
- [ ] App in **foreground**: in-app banner, inbox row, Radar moves to Live now
- [ ] App in **background**: system notification within ~5 s, correct title and retailer
- [ ] App **killed**: notification arrives; tapping opens Watch Detail (cold-start deep link)
- [ ] "Go to Checkout" action opens the Checkout Sheet

## 5. Checkout Sheet
- [ ] Retailer button opens the **retailer's app** when installed, otherwise its website
- [ ] Add a checkout profile; copy chips put each field on the clipboard
- [ ] Delete the app and reinstall: checkout profiles are gone (device-only)
- [ ] Profile → hit rate increments after opening a retailer from an alert

## 6. Calendar
- [ ] Calendar shows confirmed and rumored events with countdowns
- [ ] Set a 15-minute reminder on a near event → local notification fires on time
- [ ] Calendar subscribe link adds the feed to the phone's calendar app

## 7. Paywall (sandbox account)
- [ ] Add a 4th watch on a free account → paywall opens with live prices
- [ ] Sandbox purchase succeeds → Profile shows **Pro** within a minute (webhook)
- [ ] 4th watch now saves; Restore purchases works on the second device
- [ ] Cancel in sandbox; after expiry the account is limited to 3 active watches again

## 8. Offline and resilience
- [ ] Airplane mode → relaunch → Radar renders cached watches with an offline indicator
- [ ] Pause a watch offline → reconnect → change syncs
- [ ] Rotate / background for 10 minutes → no crash, data refreshes on return

## 9. Account
- [ ] Notification settings save (quiet hours, digest, categories)
- [ ] Export my data opens the share sheet with JSON
- [ ] Delete account on a throwaway user → signed out, sign-in creates a fresh account

## 10. Monitoring
- [ ] Sentry shows the release with source maps; a test error is symbolicated
- [ ] Analytics events appear in `analytics_daily` for this build's session
