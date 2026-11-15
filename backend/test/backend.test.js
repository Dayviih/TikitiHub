const { before, after, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const mongoose = require("mongoose");
const request = require("supertest");
const bcrypt = require("bcrypt");
const testDb = `tikitihub_test_${process.pid}_${crypto.randomBytes(5).toString("hex")}`;
const baseUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/tikitihub?replicaSet=rs0";
const testUri = new URL(baseUri);
testUri.pathname = `/${testDb}`;
process.env.MONGODB_URI = testUri.toString();

const cloudinaryPath = require.resolve("../config/cloudinary");
require.cache[cloudinaryPath] = {
  id: cloudinaryPath,
  filename: cloudinaryPath,
  loaded: true,
  exports: {
    cloudinary: { uploader: { destroy: async () => ({ result: "ok" }) } },
    uploadImage: async () => ({ url: "https://images.example.test/test.png", publicId: `test-${crypto.randomUUID()}` })
  }
};

let providerQueryCalls = 0;
let providerInitiateCalls = 0;
let providerQueryResultCode = "0";
const darajaPath = require.resolve("../services/daraja");
require.cache[darajaPath] = {
  id: darajaPath,
  filename: darajaPath,
  loaded: true,
  exports: {
    getConfig: () => ({}),
    normalizeKenyanPhone: value => {
      const digits = String(value).replace(/\D/g, "");
      if (/^254[17]\d{8}$/.test(digits)) return digits;
      if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
      throw new Error("Use a valid Kenyan mobile number.");
    },
    initiateStkPush: async () => { providerInitiateCalls += 1; return { ResponseCode: "0", MerchantRequestID: "test-merchant", CheckoutRequestID: `test-checkout-${providerInitiateCalls}`, CustomerMessage: "Test prompt" }; },
    queryStkPush: async () => { providerQueryCalls += 1; return { ResponseCode: "0", ResultCode: providerQueryResultCode }; }
  }
};

const { app } = require("../server");
const User = require("../models/User");
const Event = require("../models/Event");
const Booking = require("../models/Booking");
const Ticket = require("../models/Ticket");
const Payment = require("../models/Payment");

let customerEmail;
let customerPassword;
let customerToken;
let adminToken;
let organizerToken;
let eventId;
let bookingReference;
let administrator;

before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  customerEmail = `customer-${crypto.randomUUID()}@example.test`;
  customerPassword = "A-strong-password-123";
  const adminPassword = "A-different-password-456";
  administrator = await User.create({
    name: "Test Admin",
    email: `admin-${crypto.randomUUID()}@example.test`,
    password: await bcrypt.hash(adminPassword, 12),
    role: "admin"
  });
  const adminLogin = await request(app).post("/auth/login").send({ email: administrator.email, password: adminPassword });
  assert.equal(adminLogin.status, 200);
  adminToken = adminLogin.body.token;
});

after(async () => {
  if (mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("registration, login, live roles and account endpoints", async () => {
  const cors = await request(app).get("/").set("Origin", "http://localhost:5173");
  assert.equal(cors.headers["access-control-allow-origin"], "http://localhost:5173");
  assert.equal((await request(app).get("/").set("Origin", "https://unexpected.example")).status, 403);
  const registration = await request(app).post("/auth/register").send({
    name: "Test Customer", email: customerEmail, password: customerPassword, role: "admin"
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.user.role, "customer");
  assert.equal((await User.findOne({ email: customerEmail })).role, "customer");
  assert.equal((await request(app).post("/auth/register").send({ name: "Duplicate", email: customerEmail, password: customerPassword })).status, 409);

  const login = await request(app).post("/auth/login").send({ email: customerEmail, password: customerPassword });
  assert.equal(login.status, 200);
  customerToken = login.body.token;
  assert.equal((await request(app).get("/users/me").set("Authorization", `Bearer ${customerToken}`)).body.user.role, "customer");
  assert.equal((await request(app).get("/admin/dashboard").set("Authorization", `Bearer ${customerToken}`)).status, 403);
  assert.equal((await request(app).get("/admin/dashboard").set("Authorization", `Bearer ${adminToken}`)).status, 200);
  assert.equal((await request(app).get("/organizer/applications/me").set("Authorization", `Bearer ${customerToken}`)).status, 404);
  assert.equal((await request(app).post("/auth/forgot-password").send({ email: customerEmail })).status, 503);
});

test("organizer approval, event moderation, guest reservation, payments and ticket check-in", async () => {
  const application = await request(app).post("/organizer/applications").set("Authorization", `Bearer ${customerToken}`).send({
    organizationName: "Test Org", description: "A test organizer", phone: "0712345678"
  });
  assert.equal(application.status, 201);
  const approval = await request(app).patch(`/admin/organizer-applications/${application.body.application._id}/approve`).set("Authorization", `Bearer ${adminToken}`);
  assert.equal(approval.status, 200);
  assert.equal(approval.body.user.role, "organizer");
  assert.equal((await request(app).get("/users/me").set("Authorization", `Bearer ${customerToken}`)).status, 401);
  organizerToken = (await request(app).post("/auth/login").send({ email: customerEmail, password: customerPassword })).body.token;

  const poster = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const eventResponse = await request(app).post("/events").set("Authorization", `Bearer ${organizerToken}`)
    .field("name", "Integration Event")
    .field("description", "Integration test event")
    .field("location", "Nairobi")
    .field("date", new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())
    .field("price", "100")
    .field("capacity", "2")
    .attach("image", poster, { filename: "event.png", contentType: "image/png" });
  assert.equal(eventResponse.status, 201, JSON.stringify(eventResponse.body));
  eventId = eventResponse.body.event._id;
  assert.equal((await request(app).get(`/events/${eventId}`)).status, 404);
  const eventApproval = await request(app).patch(`/admin/events/${eventId}/approve`).set("Authorization", `Bearer ${adminToken}`);
  assert.equal(eventApproval.status, 200);
  assert.equal((await request(app).get(`/events/${eventId}`)).status, 200);
  assert.equal((await request(app).get("/organizer/events").set("Authorization", `Bearer ${organizerToken}`)).body.events.length, 1);

  const book = quantity => request(app).post("/bookings").send({
    eventId, customerName: "Test Customer", customerEmail: customerEmail, customerPhone: "0712345678", quantity
  });
  const simultaneous = await Promise.all([book(2), book(2)]);
  assert.deepEqual(simultaneous.map(result => result.status).sort(), [201, 409]);
  const reserved = simultaneous.find(result => result.status === 201).body.booking;
  bookingReference = reserved.bookingReference;
  const eventAfterReservation = await Event.findById(eventId);
  assert.equal(eventAfterReservation.ticketsReserved, 2);
  assert.equal(eventAfterReservation.ticketsSold, 0);

  const paymentKey = `test-${crypto.randomUUID()}`;
  const paymentStart = await request(app).post("/payments/mpesa/initiate")
    .set("Idempotency-Key", paymentKey)
    .send({ bookingReference, email: customerEmail, phone: "0712345678" });
  assert.equal(paymentStart.status, 202, JSON.stringify(paymentStart.body));
  assert.equal((await request(app).post("/payments/mpesa/initiate").set("Idempotency-Key", paymentKey).send({ bookingReference, email: customerEmail, phone: "0712345678" })).status, 200);
  assert.equal(providerInitiateCalls, 1);
  assert.equal((await request(app).post(`/bookings/${bookingReference}/cancel`).send({ email: customerEmail })).status, 404);
  const payment = await Payment.findOne({ booking: reserved.event ? (await Booking.findOne({ bookingReference }))._id : null });
  assert.ok(payment);
  const callback = await request(app).post("/payments/mpesa/callback").send({
    Body: { stkCallback: {
      CheckoutRequestID: payment.checkoutRequestId,
      ResultCode: 0,
      CallbackMetadata: { Item: [
        { Name: "Amount", Value: 200 },
        { Name: "MpesaReceiptNumber", Value: "TESTRECEIPT" },
        { Name: "PhoneNumber", Value: 254712345678 }
      ] }
    } }
  });
  assert.equal(callback.status, 200, JSON.stringify(callback.body));
  assert.equal(providerQueryCalls, 1);
  assert.equal((await request(app).post("/payments/mpesa/callback").send({ Body: { stkCallback: { CheckoutRequestID: payment.checkoutRequestId, ResultCode: 0 } } })).status, 200);
  assert.equal((await Booking.findOne({ bookingReference })).paymentStatus, "paid");
  assert.equal((await Event.findById(eventId)).ticketsReserved, 0);
  assert.equal((await Event.findById(eventId)).ticketsSold, 2);
  assert.equal(await Ticket.countDocuments({ booking: payment.booking, status: "valid" }), 2);
  assert.equal((await request(app).put(`/events/${eventId}`).set("Authorization", `Bearer ${organizerToken}`).field("capacity", "1")).status, 409);

  const tickets = (await request(app).get("/users/me/tickets").set("Authorization", `Bearer ${organizerToken}`)).body.tickets;
  assert.equal(tickets.length, 2);
  assert.match(tickets[0].qrCode, /^data:image\/png;base64,/);
  const checkin = await request(app).post("/tickets/verify").set("Authorization", `Bearer ${organizerToken}`).send({ ticketCode: tickets[0].ticketCode });
  assert.equal(checkin.status, 200);
  assert.equal((await request(app).post("/tickets/verify").set("Authorization", `Bearer ${organizerToken}`).send({ ticketCode: tickets[0].ticketCode })).status, 409);
  assert.equal((await request(app).get("/organizer/bookings").set("Authorization", `Bearer ${organizerToken}`)).body.statistics.sales, 200);
});

test("reservation cancellation, expiry recovery and organizer ownership", async () => {
  const event = await Event.findById(eventId);
  event.capacity = 5;
  await event.save();

  const failedReservation = await request(app).post("/bookings").send({
    eventId, customerName: "Test Customer", customerEmail, customerPhone: "0712345678", quantity: 1
  });
  assert.equal(failedReservation.status, 201);
  const failedPaymentStart = await request(app).post("/payments/mpesa/initiate")
    .set("Idempotency-Key", `test-${crypto.randomUUID()}`)
    .send({ bookingReference: failedReservation.body.booking.bookingReference, email: customerEmail, phone: "0712345678" });
  assert.equal(failedPaymentStart.status, 202);
  const failedPayment = await Payment.findOne({ booking: (await Booking.findOne({ bookingReference: failedReservation.body.booking.bookingReference }))._id });
  providerQueryResultCode = "1032";
  assert.equal((await request(app).post("/payments/mpesa/callback").send({ Body: { stkCallback: { CheckoutRequestID: failedPayment.checkoutRequestId, ResultCode: 1032 } } })).status, 200);
  assert.equal((await Booking.findOne({ bookingReference: failedReservation.body.booking.bookingReference })).paymentInProgress, false);
  assert.equal((await request(app).post(`/bookings/${failedReservation.body.booking.bookingReference}/cancel`).send({ email: customerEmail })).status, 200);

  providerQueryResultCode = "0";
  const reconciledReservation = await request(app).post("/bookings").send({
    eventId, customerName: "Test Customer", customerEmail, customerPhone: "0712345678", quantity: 1
  });
  assert.equal(reconciledReservation.status, 201);
  assert.equal((await request(app).post("/payments/mpesa/initiate")
    .set("Idempotency-Key", `test-${crypto.randomUUID()}`)
    .send({ bookingReference: reconciledReservation.body.booking.bookingReference, email: customerEmail, phone: "0712345678" })).status, 202);
  const pendingPayment = await Payment.findOne({ booking: (await Booking.findOne({ bookingReference: reconciledReservation.body.booking.bookingReference }))._id });
  assert.equal((await request(app).post(`/admin/payments/${pendingPayment._id}/reconcile`).set("Authorization", `Bearer ${adminToken}`)).status, 200);
  assert.equal((await Booking.findOne({ bookingReference: reconciledReservation.body.booking.bookingReference })).paymentStatus, "paid");

  const created = await request(app).post("/bookings").send({
    eventId, customerName: "Test Customer", customerEmail, customerPhone: "0712345678", quantity: 1
  });
  assert.equal(created.status, 201);
  const cancelled = await request(app).post(`/bookings/${created.body.booking.bookingReference}/cancel`).send({ email: customerEmail });
  assert.equal(cancelled.status, 200);
  assert.equal((await Event.findById(eventId)).ticketsReserved, 0);

  const expired = await Booking.create({
    bookingReference: `TH-${crypto.randomBytes(12).toString("hex").toUpperCase()}`,
    event: eventId,
    customerName: "Test Customer",
    customerEmail,
    customerPhone: "0712345678",
    quantity: 1,
    unitPrice: 100,
    totalAmount: 100,
    expiresAt: new Date(Date.now() - 60_000)
  });
  await Event.updateOne({ _id: eventId }, { $inc: { ticketsReserved: 1 } });
  const nextReservation = await request(app).post("/bookings").send({
    eventId, customerName: "Test Customer", customerEmail, customerPhone: "0712345678", quantity: 1
  });
  assert.equal(nextReservation.status, 201);
  assert.equal((await Booking.findById(expired._id)).status, "expired");
  assert.equal((await Event.findById(eventId)).ticketsReserved, 1);

  const anotherOrganizer = await User.create({ name: "Other Organizer", email: `other-${crypto.randomUUID()}@example.test`, password: await bcrypt.hash(customerPassword, 12), role: "organizer" });
  const otherToken = (await request(app).post("/auth/login").send({ email: anotherOrganizer.email, password: customerPassword })).body.token;
  assert.equal((await request(app).put(`/events/${eventId}`).set("Authorization", `Bearer ${otherToken}`).field("name", "Stolen edit")).status, 403);
  assert.equal((await request(app).get("/organizer/bookings").set("Authorization", `Bearer ${otherToken}`)).body.bookings.length, 0);
  assert.equal((await request(app).patch(`/admin/users/${anotherOrganizer._id}`).set("Authorization", `Bearer ${adminToken}`).send({ role: "organizer" })).status, 400);
});

test("organizer profile and password changes revoke prior access tokens", async () => {
  const profile = await request(app).put("/organizer/me").set("Authorization", `Bearer ${organizerToken}`).send({
    organizationName: "Updated Test Org", description: "Updated profile", phone: "0711111111"
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.profile.organizationName, "Updated Test Org");

  const nextPassword = "A-new-strong-password-789";
  const changed = await request(app).patch("/users/me/password").set("Authorization", `Bearer ${organizerToken}`).send({
    currentPassword: customerPassword, newPassword: nextPassword
  });
  assert.equal(changed.status, 200);
  assert.equal((await request(app).get("/users/me").set("Authorization", `Bearer ${organizerToken}`)).status, 401);
  assert.equal((await request(app).post("/auth/login").send({ email: customerEmail, password: nextPassword })).status, 200);
});
