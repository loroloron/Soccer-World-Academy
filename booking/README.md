# Soccer World Academy bookings

One-hour private lessons ($50) and group bookings ($20 per player, at least 11 players). Monday–Friday 6–8 PM, Saturday 2–6 PM, Sunday 2–5 PM, all America/Indiana/Indianapolis time. A single organizer books an entire group; this does not accumulate individual signups toward a group minimum.

## Current deployment state

The public website displays the hours and prices. Its `booking-config.js` stays disabled until the booking server and persistent disk are deployed and verified. No paid infrastructure has been created by adding these files.

## Run locally

Use Node 24. Set BOOKING_SECRET to at least 32 random characters and ADMIN_TOKEN to at least 16 characters in your environment. Run `node server.mjs`. It listens on PORT (default 3000); local SQLite data is stored in ignored `data/`. Run `npm test` for isolated integration tests.

## Deploy

The root render.yaml defines a new Node web service, with rootDir `booking`, one 0.5c-512mb instance, and a 1 GB persistent disk at /var/data. This adds paid hosting; review the Render estimate before applying. It does not replace or reconfigure the existing static site. Set ADMIN_TOKEN in Render to a private owner password of at least 16 characters. Keep BOOKING_SECRET stable across redeployments to preserve customer confirmation links. The service refuses production startup without the required database path and secrets.

After deployment, confirm /api/health and /api/config. Update the static site's root booking-config.js to `window.SWA_BOOKING_API = 'https://ACTUAL-SERVICE-URL';` using the actual returned service URL, and verify availability and owner login before telling customers booking is open. Existing site and QR code keep working.

## Owner operations

Open /admin.html on the booking server. Enter ADMIN_TOKEN as the owner password to list or cancel reservations and download a JSON backup. The password stays in page memory until logout/reload; it is not stored in the browser. Maintain regular backups with this export. No customer records are committed to Git or served as static files.

Customers receive a private confirmation link on screen and may download a calendar event or cancel a future booking. No email, text notification, online payment, refund processing, or customer account is provided. No payment is collected by the form. The price is a reservation total, not a paid receipt. Booking dates are limited to the next 90 days; hours are not exceptions-aware, so owner cancellations are available for holidays or weather.

## Validation

Tests cover conflicts between concurrent private/group requests, repeat submissions, persistence across restart, minimum group size and server-side prices, daylight-saving changes, invalid input, cancellation and slot reuse, customer token protection, owner authorization, and denial of database/source-file downloads.
