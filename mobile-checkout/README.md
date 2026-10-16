# NXGS mobile checkout

The station QR opens this page with an attempt-specific capability in the URL
fragment. Customers enter their name and Indian mobile number, then continue to
Razorpay. Names and phone numbers are stored on `public.pc_checkouts`; the page
never receives a station client token or a Supabase service key.

Production page: https://nxgs-play-checkout.vercel.app/

- Vercel project: `nxgs-play-checkout` (`prj_RLRZWKbCaAc2gfjEbR0oZEdqCRp9`).
- Vercel team: `soowankis-projects-9af25d9d` (`team_CF5SckACLGo9eVYI4Kc6magY`).
- Static source: `index.html`, `checkout.css`, `checkout.js`, `vercel.json`.
- Supabase project: `nxgs_play` (`oqcezdcnozgguytudliv`).
- Backend: `supabase/functions/pcPayment/`, deployed as `pcPayment`.

Deploy these four static files to the existing Vercel project as a production
deployment; there is no install or build step. Deploy both TypeScript files when
updating the Edge Function, preserving `verify_jwt = false` because it performs
its own station API-key and mobile-capability checks. Apply the customer-details
migration before deploying the updated function.

`NXGS_PC_CHECKOUT_PAGE_URL` optionally overrides the page URL in the Edge
Function. When moving to a different Supabase project, update the page's API
endpoint and Content Security Policy as well. Check that production aliases
remain publicly accessible without a hosting sign-in.

New checkouts wait for details before creating a payment link. Submissions are
claimed atomically, repeated taps resume the same link, and retries invalidate
old phone capabilities. Existing checkout rows continue using their original
provider URLs. Payment capture and one-time station entitlement consumption
remain server-authoritative. No desktop installer is needed to activate this
server-side flow in existing stations.

Validation:

```powershell
npm run test:mobile-checkout
npm run typecheck
npx deno check --node-modules-dir=none supabase/functions/pcPayment/index.ts
npm run build
```

For a live check, create an unpaid verification checkout, scan its actual QR,
submit synthetic details, confirm persistence and Razorpay prefill, then cancel
the verification checkout from the station API. Never use customer phone numbers
for test submissions. Notifications remain disabled on provider links.
