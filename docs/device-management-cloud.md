# Device Management cloud backend (`stationFleet`)

NXGS Play 0.25.0 adds an **Accounts** tab (earnings) and an **All Devices** tab
(Device Management). Stations stay local-first; cross-device data goes through
one Supabase edge function, `stationFleet`, in project `oqcezdcnozgguytudliv`.
The renderer never talks to the cloud: the Electron main process
(`src/main/fleetService.ts`) holds the station token and the short-lived
main admin (owner) token.

## What the function does

Every request is `POST /functions/v1/stationFleet` with the publishable key in
the `apikey` header (same check as `pcPayment`, including
`SUPABASE_PUBLISHABLE_KEYS`) and a JSON body `{ "action": ... }`.

| Who | Actions |
| --- | --- |
| Station (`station_id` + `station_token`) | `register`, `sync` (station details, games, up to 200 sessions; returns the stored details, game on/off overrides and assigned moderators), `session_payers` |
| Main admin (`owner_token`) | `owner_login`, `owner_logout`, `owner_change_pin`, `list_stations`, `get_station`, `update_station`, `remove_station`, `set_game_enabled`, `earnings`, `list_moderators`, `save_moderator`, `delete_moderator` |

Failures are `{ "error": true, "message": "<code>" }` with
`unauthorized_client`, `unauthorized_station`, `station_removed`,
`station_already_registered`, `owner_pin_required`, `invalid_owner_pin`,
`owner_locked` (plus `locked_until`), `not_found`, `invalid_input` (plus
`detail`, the offending field) or `request_failed`. Database and Razorpay errors
are logged in the function logs and never returned.

Code: `supabase/functions/stationFleet/index.ts` (actions),
`validate.ts` (input limits), `pin.ts` (PIN/token hashing and the lockout
policy; hash format shared with `src/main/pinHash.ts`), and
`supabase/functions/_shared/razorpayPayer.ts` (payer mapping shared with
`pcPayment`).

## Tables

Migration `20261017120000_station_fleet.sql`:

- `fleet_owner` - the single main admin row (id 1): PIN hash, failed attempts, lockouts, lock.
- `fleet_owner_sessions` - main admin sessions (token hash, sliding expiry).
- `fleet_stations` - one row per station device ID; token hash, details, removal.
- `fleet_station_games` - each station's library plus pending owner on/off overrides.
- `fleet_sessions` - paid sessions synced from stations (games played as JSON).
- `fleet_moderators`, `fleet_moderator_stations` - moderators and their stations.
- View `fleet_station_totals` - game/session counts and revenue per station.

All have RLS enabled, `public`/`anon`/`authenticated` revoked and only
`service_role` granted. Migration `20261017120100_checkout_payer_details.sql`
adds optional Razorpay payer columns to `pc_checkouts` (phone, email, name,
method, UPI ID, bank, wallet, card network and last 4, paid time, fetch time).

Migration `20261017130000_fleet_hardening.sql` (additive only) adds
`fleet_owner.lockout_count`, `fleet_stations.owner_edit_pending` and
`pc_checkouts.consumed_by_station_id`.

## Deploying

The first two migrations are already applied. Apply the hardening migration
**before** deploying the functions (both read its columns):

```powershell
npx supabase link --project-ref oqcezdcnozgguytudliv
npx supabase migration list      # only 20261017130000 should be pending
npx supabase db push
npx supabase functions deploy stationFleet --project-ref oqcezdcnozgguytudliv --no-verify-jwt
npx supabase functions deploy pcPayment --project-ref oqcezdcnozgguytudliv --no-verify-jwt
```

`--no-verify-jwt` is required because callers send the publishable key, not a
user JWT (pcPayment is already deployed the same way). Instead of `db push`, the
SQL file can be run in the Dashboard SQL editor; it is idempotent and contains
no drop or revoke statements.

Secrets: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the publishable keys
are provided by the platform. Payer backfill uses the existing project secrets
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`; without them earnings still work and
payer details stay empty.

`pcPayment` changes, none of which can block a payment:

- When a payment verifies it saves payer details, fetching the payment with
  `?expand[]=card`. If the card expansion fails it refetches without it; if
  saving the payer columns fails it saves the verification without them.
- `consume` returns the payer as `entitlement.payer` and accepts an optional
  `station_id`, stored as `consumed_by_station_id` in the same update. An
  invalid id is ignored; if the update with it fails, the consume is retried
  without it.

Run `npm run test:fleet-backend` after any change to these files.

## Main admin PIN

- The default main admin PIN is **1832**. While `fleet_owner.pin_hash` is null
  the default applies; the first successful login stores a hash of it.
- Change it from the **All Devices** tab (change main admin PIN, `owner_change_pin`).
  This needs the current PIN and signs out every other main admin session.
  Change it on the first day (the default is published here) and use 6 or more
  digits; 4-12 digits are accepted.
- Forgotten PIN: run in the SQL editor
  `update public.fleet_owner set pin_hash = null, failed_attempts = 0, lockout_count = 0, locked_until = null where id = 1;`
  `delete from public.fleet_owner_sessions;` - the PIN is 1832 again.

## Lockout and sessions

- Every main admin PIN attempt (login, and the current PIN when changing it)
  is counted before the PIN is checked, so parallel guesses cannot bypass the limit.
- 5 consecutive wrong PINs lock main admin login (`owner_locked`, with
  `locked_until`). The first lockout lasts 10 minutes and each further lockout
  doubles it (20, 40, 80 minutes ...) up to 24 hours. After a lock ends there
  are 5 new attempts. A correct PIN resets both the attempt and lockout counts.
- Unlock with SQL if needed:
  `update public.fleet_owner set failed_attempts = 0, lockout_count = 0, locked_until = null where id = 1;`
- Owner sessions last 30 minutes and every authorised owner call extends them.
  The station also clears its owner token when admin mode ends.

## Stations, edits and moderators

- **Register.** The station generates its own 32-byte token, saves it locally,
  then calls `register`. Only the token's SHA-256 is stored. Retrying with the
  same token is harmless, so a lost response never strands a station.
- **Rejoin / re-key.** A removed station, or a registered device ID that comes
  back with a different token (for example after a reinstall), needs the main
  admin PIN. Without it the station gets `station_removed` or
  `station_already_registered`; with it the new token replaces the old one and
  the removal is cleared.
- **Remove.** `remove_station` clears the station's token and moderator
  assignments. Its games and sessions stay for earnings history.
- **Who wins on edits (no clocks compared).** A main admin edit to a station's
  name/store/location/status sets `owner_edit_pending`. It stays in force until
  the station reports the same values, which clears the flag. Without a pending
  edit, a station that reports local edits (`dirty`) wins. Otherwise the stored
  values stay. `sync` always returns the stored values.
- **Game on/off.** A main admin toggle is pending while `owner_enabled` is set
  and is sent to the station on every sync. It is cleared once the station
  reports the same `enabled`. `local_updated_at` columns are information only.
- Moderator PIN hashes are sent only to stations they are assigned to (in the
  `sync` response) so the Control Room PIN works offline.

## Earnings and payer details

- `earnings` returns at most 5,000 sessions, newest first, and
  `truncated: true` when more matched; narrow the date range in that case.
- A checkout counts for a session only when `consumed_by_station_id` is empty
  (consumed before 0.25.0) or matches the session's station. `payment_verified`
  and `payers` follow that rule, so another station cannot claim a payment by
  syncing its checkout ID.
- `session_payers` returns only checkouts referenced by the calling station's
  own sessions under the same rule, and only those whose details are known, so
  the station asks again later for the rest.
- Missing payer details are fetched from Razorpay lazily: at most 20 checkouts
  per request, 5 at a time, with all calls ending within 5 seconds. If the card
  expansion fails the plain payment is fetched. Failures store nothing and are
  retried on the next request. Full card numbers are never returned by Razorpay
  or stored.

## Security notes

- The publishable key only identifies the app. Real access control is the
  station token (station actions) and the owner token (main admin actions).
- Tokens and PINs are stored only as hashes. Tokens and the default PIN are
  compared in constant time. Owner-facing responses never include token or PIN
  hashes.
- 4-12 digit PINs are easy to brute-force from a hash, whatever the iteration
  count. Treat moderator PIN hashes cached on stations
  (`%APPDATA%\nxgs-play\nxgs-play-data.json`) as sensitive. Moderators should
  not reuse the main admin PIN, and the main admin PIN hash never leaves the
  cloud.
- Lists are read in pages of 1,000 rows (the Supabase API default `max_rows`).
  If `max_rows` is lowered, raise it back or long lists will be cut short.
