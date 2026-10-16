# Name and phone checkout validation

Verified on 16 October 2026 against Supabase `nxgs_play` and the deployed Vercel
page. The live function was updated from version 5 to version 6.

- Decoded the actual SVG QR returned by the station create API and opened that
  URL at a 390 px phone viewport.
- Submitted synthetic name and phone details through the form, verified the
  stored columns and confirmed the Razorpay checkout displayed the prefilled
  phone number.
- Confirmed invalid details are rejected, mobile access cannot consume play
  time, an unpaid checkout cannot be consumed, and reopening payment resumes
  the same link.
- Cancelled the unpaid verification checkout and confirmed further mobile
  payment requests are rejected. No payment was captured and no money moved.
- The existing Razorpay configuration displayed **Test Mode**. Real payment
  collection requires the owner's live Razorpay configuration.
- Database RLS and service-role-only table access remain in place. Security
  advisors returned the same four informational findings as before the change.

`npm run test:mobile-checkout`, `npm run typecheck`, Deno checking and
`npm run build` passed. The mobile regression test includes duplicate submissions,
expiry before details, retry capability invalidation, underpayment rejection,
single-use entitlement, cancellation during slow provider creation, and legacy
QR compatibility.

The existing `npm run test:paid-session` script fails at its obsolete
`function GameSwitchDialog` source assertion. That symbol is absent from the
unchanged renderer at the baseline commit; this change does not touch launcher
or game-switching code. Full real-money payment capture was not tested.

The mobile page was checked at phone size. See `mobile-checkout-preview.png`
for the form before submission.
