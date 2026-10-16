# Razorpay name collection constraint

The required experience is: scan the station QR, enter name and phone on the
customer's phone within Razorpay's current hosted checkout, and pay. No name
entry on the station and no separately hosted website are wanted.

The station uses Razorpay Standard Payment Links. The documented `customer.name`
API parameter supplies a name already collected by the merchant; it does not
declare a new editable input in the hosted payment form. No supported custom
Name input setting was found in the Payment Links documentation.

Razorpay Payment Pages support custom input fields and Razorpay hosting. That
would change the Razorpay product and payment tracking integration and has not
been implemented or approved as a substitute for the current Payment Link.

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

The original Razorpay setup showed Test Mode during verification. No real
charge was made. The restored direct QR flow was verified with an unpaid test
checkout and that checkout was cancelled afterwards.

The existing `test:paid-session` script has a pre-existing obsolete
`function GameSwitchDialog` assertion; the renderer has not been changed.
