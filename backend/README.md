# TikitiHub backend

Express and Mongoose API for event moderation, guest checkout, ticketing and organizer administration.

## Run locally

Use Node.js 20 or later. Copy `.env.example` to `.env`, fill in the required values, and keep `.env` out of Git. Set `JWT_SECRET` to at least 32 random bytes. Cloudinary credentials are required at startup because event posters use Cloudinary.

```sh
npm install
npm start
```

The default MongoDB URI connects to the local `rs0` replica set. Booking inventory, payment confirmation and ticket creation use transactions, so a standalone MongoDB server is not supported for these operations. The health endpoint is `GET /`.

Create the first administrator interactively with `node scripts/createAdmin.js`. Reset an administrator password with `node scripts/resetAdminPassword.js`. These scripts never print passwords or email addresses.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | No | HTTP listen port; defaults to `3000`. |
| `MONGODB_URI` | No | MongoDB URI; defaults to local database `tikitihub` on replica set `rs0`. |
| `JWT_SECRET` | Yes | HMAC key of at least 32 characters for one-hour access tokens. |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Yes | Event poster storage. |
| `CORS_ORIGINS` | No | Comma-separated browser origins. Local Vite origins are allowed by default. |
| `FRONTEND_URL` | Password reset | Frontend URL that hosts `/reset-password`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email delivery | Resend API and verified sender. Outbox records remain queued if these are absent. |
| `DARAJA_ENV` | M-Pesa | `sandbox` or `production`; defaults to `sandbox`. |
| `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORT_CODE`, `DARAJA_PASSKEY` | M-Pesa | Daraja app and STK Push credentials. |
| `DARAJA_CALLBACK_URL` | M-Pesa | Public HTTPS URL for `POST /payments/mpesa/callback`; configure the same URL in the Daraja app. |

Do not put credentials in source control. Daraja and Resend values are not required for the server to start. Password reset returns `503` until email delivery and `FRONTEND_URL` are configured. M-Pesa initiation returns `503` until Daraja is configured.

## Roles and security

- Public registration always creates a customer; submitted `role` fields are ignored.
- Organizer access is granted only by approving an organizer application. Role changes invalidate existing JWTs.
- JWTs expire after one hour. Current user role and token version are checked from MongoDB on protected requests.
- Passwords require 12–72 UTF-8 bytes and use bcrypt. Password change/reset revokes existing access tokens.
- Event creation requires an approved organizer or administrator. New events are pending and only approved future events are public.
- Booking holds inventory for 10 minutes. Reservation, payment confirmation, ticket creation and inventory movement use replica-set transactions.
- Tickets contain opaque random codes. The ticket API returns QR PNG data URLs containing only those codes. Organizer check-in is restricted to events owned by that organizer, and the transition from valid to used is atomic.
- API responses never return password hashes, reset tokens, Daraja credentials, or email outbox message bodies. Public booking status requires both the booking reference and checkout email.

The included in-process rate limiter is suitable for a single backend instance. Use a shared rate-limit store when running multiple instances. Terminate TLS at a trusted reverse proxy in production, and set `CORS_ORIGINS` to the exact frontend origins.

## API routes

Use `Authorization: Bearer <token>` for protected routes. JSON requests use `Content-Type: application/json`. Event poster create/update requests are `multipart/form-data` with an `image` file.

| Method | Path | Access |
| --- | --- | --- |
| `GET` | `/` | Public health check |
| `POST` | `/auth/register` | Public customer registration |
| `POST` | `/auth/login` | Public login |
| `POST` | `/auth/forgot-password` | Public; queues a reset email |
| `POST` | `/auth/reset-password` | Public; consumes single-use token |
| `GET`, `PATCH` | `/users/me` | Signed-in user profile |
| `PATCH` | `/users/me/password` | Signed-in user password change |
| `GET` | `/users/me/bookings` | Signed-in account email booking history |
| `GET` | `/users/me/tickets` | Signed-in tickets and QR images; supports `page`, `limit` |
| `POST` | `/organizer/applications` | Customer application; rejected applications may be resubmitted |
| `GET` | `/organizer/applications/me` | Signed-in application status |
| `PUT` | `/organizer/me` | Organizer profile |
| `GET` | `/organizer/events` | Organizer's own events; supports pagination |
| `GET` | `/organizer/bookings` | Own event bookings and paid sales totals |
| `POST` | `/events` | Organizer/admin; image upload; event starts pending |
| `PUT`, `DELETE` | `/events/:id` | Owner organizer or admin |
| `GET` | `/events` | Public approved upcoming events; supports pagination |
| `GET` | `/events/search` | Public filters: `location`, `q`, `minPrice`, `maxPrice`, `dateFrom`, `dateTo`, `sort`, `page`, `limit` |
| `GET` | `/events/:id` | Public approved upcoming event |
| `POST` | `/bookings` | Public guest reservation; quantity 1–10 |
| `POST` | `/bookings/:reference/cancel` | Public unpaid reservation cancellation; requires checkout email |
| `POST` | `/payments/mpesa/initiate` | Public checkout; requires `Idempotency-Key` header |
| `POST` | `/payments/mpesa/callback` | Daraja callback; verified by server-side STK query |
| `GET` | `/payments/:bookingReference/status` | Public status lookup; requires checkout `email` query parameter |
| `POST` | `/tickets/verify` | Organizer for own event or admin; atomically checks in ticket |
| `GET` | `/admin/dashboard`, `/admin/activity` | Admin statistics and recent platform activity |
| `GET`, `PATCH` | `/admin/users`, `/admin/users/:id` | Admin user listing and activation/demotion; organizer activation requires application approval |
| `GET` | `/admin/organizer-applications`, `/admin/organizer-applications/pending` | Admin application review queue/history |
| `PATCH` | `/admin/organizer-applications/:id/approve` | Admin; atomically approves and activates organizer |
| `PATCH` | `/admin/organizer-applications/:id/reject` | Admin; requires a rejection reason |
| `GET` | `/admin/events`, `/admin/events/pending` | Admin moderation queue/list |
| `PATCH` | `/admin/events/:id/approve`, `/admin/events/:id/reject` | Admin event moderation |
| `GET` | `/admin/bookings` | Admin booking overview |
| `GET` | `/admin/payments` | Admin payment overview |
| `POST` | `/admin/payments/:id/reconcile` | Admin; queries Daraja before updating payment state |
| `GET` | `/admin/tickets` | Admin ticket overview |
| `PATCH` | `/admin/tickets/:id/void` | Admin ticket invalidation |
| `GET` | `/admin/notifications` | Admin outbox status (message bodies are withheld) |
| `POST` | `/admin/notifications/:id/retry` | Admin retry for pending/failed email |

Admin listing endpoints support `page` and `limit`; applicable lists also accept a `status` filter.

## M-Pesa setup

1. Create a Daraja app and enter its consumer key/secret, shortcode and passkey in `.env`.
2. Use `DARAJA_ENV=sandbox` for sandbox credentials. Production also requires Safaricom approval and production credentials.
3. Expose the backend callback over public HTTPS and set the exact URL in both `DARAJA_CALLBACK_URL` and the Daraja app.
4. Create a guest reservation with `POST /bookings`, then call `POST /payments/mpesa/initiate` with its reference, email and Kenyan mobile number. Reuse the same `Idempotency-Key` for retries of that request.
5. The API does not accept a frontend success claim. Callback and admin reconciliation query Daraja; only a verified result confirms the booking, moves inventory, and generates tickets.

Only Daraja STK Push is implemented. Airtel Money, cards and bank transfers need their provider integrations and credentials. No live payment success should be inferred from the automated test suite: it stubs the Daraja adapter.

## Email and notifications

Email messages are saved to a MongoDB outbox before delivery. Configure Resend with `RESEND_API_KEY` and `EMAIL_FROM`; configure `FRONTEND_URL` for password reset links. Delivery failures retry with backoff; admins can inspect status and retry failed records. Without email credentials, records remain pending and bookings/tickets still persist.

## Automated tests

```sh
npm test
```

The suite requires the local `rs0` MongoDB replica set. It connects to a randomly named test database and drops only that database at teardown. Cloudinary and Daraja are controlled stubs. Tests cover registration, duplicate email, role protection, organizer approval, event moderation, concurrent inventory reservations, cancellation, expired reservation recovery, payment idempotency and verification, ticket issuance/QR/check-in, ownership checks, dashboard access, and password-token revocation.

For manual API checks, import these routes into Postman using `http://localhost:3000` as the base URL. Register a customer, log in and save `token`; create the first admin with the setup script and log in as that admin; submit and approve an organizer application; create and approve an event; reserve a guest booking; and exercise the Daraja flow only with configured sandbox credentials.

## Data and migrations

Existing MongoDB documents remain valid: newly added account, booking, payment, ticket and notification fields use defaults. Mongoose creates the declared indexes when the models initialize. No collection drop or destructive migration is required. The test command uses a separate random database.
