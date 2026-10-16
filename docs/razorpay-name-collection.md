# Razorpay-hosted name collection

The required experience is: scan the station QR, enter name and phone on the
customer's phone within Razorpay's current hosted checkout, and pay. No name
entry on the station and no separately hosted website are wanted.

The station uses Razorpay Standard Payment Links. The documented `customer.name`
API parameter supplies a name already collected by the merchant; it does not
declare a new editable input in the hosted payment form. No supported custom
Name input setting was found in the Payment Links documentation.

Razorpay Payment Pages support custom input fields and Razorpay hosting. A test
Payment Page was published on 2026-10-16 for the owner to review:

- Page ID: `pl_ToeSRsdyPnPROc`
- Published URL: https://rzp.io/rzp/RYNDBXiE
- Prefill demonstration: https://pages.razorpay.com/pl_ToeSRsdyPnPROc/view?amount=1&session_reference=nxgs_test_preview_20261016
- Required fields: Amount, Email, Phone, Full Name, Session Reference.
- Support details: `nxgsstudio@gmail.com`, `+917005651676`, supplied by the owner.
- Amount uses Customers Decide Amount with a minimum of INR 1 and maximum of
  INR 100,000. The URL fills `amount` (rupees) and `session_reference`.
- The page visibly states Test Mode. It cannot collect real payments.

The public form and its amount/reference prefills were verified in the browser.
A simulated checkout was opened with synthetic customer details. Browser
automation could read the embedded Razorpay payment window but could not click
its payment controls. No successful payment or capture has been verified.

The owner subsequently reported that the phone page keeps loading, then finishes
as a blank page. This was
reproduced in Chrome: the published short URL resolves to the correct long URL,
but the form container stays empty. The dashboard confirms Active / No Expiry.
Republishing with the basic Light theme did not resolve the Chrome failure.
The same public page still renders in the in-app browser, and an existing
cancelled Payment Link displays its expected inactive message in Chrome.
The exact cause is not established; this preview is not ready for customer use.

If the owner confirms the official short URL also hangs when opened directly in
the phone's Chrome/Safari, the following diagnostic can be sent to Razorpay
support by the owner (no support request has been sent automatically):

> Test Payment Page `pl_ToeSRsdyPnPROc` is Active with No Expiry. Its published
> short link `https://rzp.io/rzp/RYNDBXiE` resolves to
> `https://pages.razorpay.com/pl_ToeSRsdyPnPROc/view`, but the customer form
> remains blank in desktop Chrome and on the owner's phone after loading. It
> renders in a separate in-app browser. Republishing with the Light theme did
> not resolve it. Existing Payment Links render in Chrome. Please investigate
> the hosted Payment Page loading failure and advise what diagnostics you need.

The station QR still uses the existing Payment Link flow. The published test
page is a preview, not a completed backend integration. Before switching QR
codes, verify a captured test payment's custom fields and implement provider-side
amount, currency, session-reference, and replay checks. Only then save the
customer name and phone from the verified Razorpay response into `pc_checkouts`.
Do not trust URL fields or browser success messages to grant play time. Retrying,
cancelling, and expiring a station checkout also need handling: a shared Payment
Page cannot cancel one customer's prefilled URL like an individual Payment Link.

References:

- https://razorpay.com/docs/api/payments/payment-links/create-standard/
- https://razorpay.com/docs/payments/payment-pages/create/
- https://razorpay.com/docs/payments/payment-pages/customise/

The previously added separate mobile form and its endpoints have been removed.
`pcPayment/index.ts` is restored to its pre-form implementation, so new QR codes
point directly at Razorpay again. No station input fields were added.

The customer-details migration is retained to match the applied Supabase
migration history and preserve data. Its optional columns do not add public
table access or affect the restored checkout code. The Deno dependency lockfile
is also retained.

The unused Vercel project `nxgs-play-checkout` is paused. It is no longer used
by the payment flow. Deletion of that project, if desired, is an owner action in
Vercel; no Vercel dependency remains in the app or payment function.

No real charge was made. The restored direct QR flow was previously verified
with an unpaid test checkout and that checkout was cancelled afterwards.

The existing `test:paid-session` script has a pre-existing obsolete
`function GameSwitchDialog` assertion; the renderer has not been changed.
