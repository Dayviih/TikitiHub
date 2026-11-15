
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const crypto = require("crypto");
const QRCode = require("qrcode");

const connectDB = require("./db");
const Event = require("./models/Event");
const Booking = require("./models/Booking");
const User = require("./models/User");
const OrganizerApplication = require("./models/OrganizerApplication");
const Payment = require("./models/Payment");
const Ticket = require("./models/Ticket");
const Notification = require("./models/Notification");

const authenticateToken = require("./middleware/auth");
const authorizeRoles = require("./middleware/authorize");

const upload = require("./middleware/upload");
const { uploadImage, cloudinary } = require("./config/cloudinary");
const daraja = require("./services/daraja");
const { queueEmail, retryDueNotifications } = require("./services/notifications");

const app = express();
const PORT = process.env.PORT || 3000;
const RESERVATION_MINUTES = 10;
const RESERVATION_CLEANUP_INTERVAL_MS = 60 * 1000;
let reservationCleanupRunning = false;

// Check environment variables
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters.");
}

const cloudinaryVariables = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET"
];

if (!cloudinaryVariables.every(key => process.env[key])) {
  throw new Error("Cloudinary credentials are missing from .env");
}

// Middleware
app.use(express.json({ limit: "1mb" }));
app.disable("x-powered-by");
app.set("query parser", "simple");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'"
  });

  const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173")
    .split(",").map(origin => origin.trim()).filter(Boolean);
  const origin = req.get("origin");
  if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes("*"))) {
    res.set("Access-Control-Allow-Origin", allowedOrigins.includes("*") ? "*" : origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  } else if (origin && allowedOrigins.length) {
    return res.status(403).json({ message: "Origin is not allowed." });
  }

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const rateLimitBuckets = new Map();
function rateLimit({ windowMs, max, keyPath = true }) {
  return (req, res, next) => {
    const key = `${req.ip}${keyPath ? `:${req.baseUrl}${req.route?.path || req.path}` : ""}`;
    const now = Date.now();
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count += 1;
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) {
      res.set("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ message: "Too many requests. Please try again later." });
    }
    if (rateLimitBuckets.size > 10000) {
      for (const [bucketKey, value] of rateLimitBuckets) {
        if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
      }
    }
    next();
  };
}
const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const bookingRateLimit = rateLimit({ windowMs: 60 * 1000, max: 20 });
const globalRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, keyPath: false });
app.use(globalRateLimit);

async function safeQueueEmail(message) {
  try {
    await queueEmail(message);
  } catch (error) {
    logError("Notification could not be queued:", error);
  }
}

function logError(context, error) {
  console.error(context, error?.name || "Error");
}

// Validate MongoDB IDs
function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Check event ownership
function canManageEvent(event, user) {
  if (user.role === "admin") {
    return true;
  }

  return event.organizer.toString() === user.userId;
}

// Validate event details
function validateEventInput(data) {
  const { name, description, location, date, price, capacity } = data;

  if (
    typeof name !== "string" || !name.trim() ||
    typeof description !== "string" || !description.trim() ||
    typeof location !== "string" || !location.trim() ||
    date === undefined ||
    price === undefined ||
    capacity === undefined
  ) {
    return "Please provide all required event details.";
  }

  if (
    !Number.isFinite(Number(price)) ||
    Number(price) < 0
  ) {
    return "Price must be a valid non-negative number.";
  }

  if (
    !Number.isInteger(Number(capacity)) ||
    Number(capacity) < 1
  ) {
    return "Capacity must be a positive whole number.";
  }

  if (Number.isNaN(new Date(date).getTime())) {
    return "Please provide a valid event date.";
  }

  return null;
}

// Escape special characters in search input
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function supportsMongoTransactions() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  return Boolean(hello.setName || hello.msg === "isdbgrid");
}

async function runMongoTransaction(operation) {
  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function settleVerifiedPayment(paymentId, confirmation) {
  return runMongoTransaction(async session => {
    const payment = await Payment.findOneAndUpdate(
      { _id: paymentId, status: "pending", amount: confirmation.amount },
      { $set: {
        status: "paid",
        resultCode: "0",
        mpesaReceiptNumber: confirmation.receipt,
        providerResult: { verifiedByQuery: true },
        verifiedAt: new Date()
      } },
      { returnDocument: "after", session }
    );
    if (!payment) return false;

    const booking = await Booking.findOneAndUpdate(
      { _id: payment.booking, status: "reserved", paymentStatus: "pending", paymentInProgress: true },
      { $set: {
        status: "confirmed",
        paymentStatus: "paid",
        paymentMethod: "mpesa",
        paymentReference: confirmation.receipt,
        paymentInProgress: false,
        reservationReleased: true
      } },
      { returnDocument: "after", session }
    );
    if (!booking) throw new Error("Payment could not be applied to an active reservation.");

    const inventory = await Event.updateOne(
      { _id: booking.event, ticketsReserved: { $gte: booking.quantity } },
      { $inc: { ticketsReserved: -booking.quantity, ticketsSold: booking.quantity } },
      { session }
    );
    if (inventory.modifiedCount !== 1) throw new Error("Reserved ticket inventory is inconsistent.");

    const tickets = Array.from({ length: booking.quantity }, () => ({
      ticketCode: crypto.randomBytes(24).toString("base64url"),
      booking: booking._id,
      event: booking.event
    }));
    await Ticket.create(tickets, { session, ordered: true });
    const event = await Event.findById(booking.event).select("name").session(session);
    await Notification.create([{
      type: "booking_confirmation",
      recipient: booking.customerEmail,
      subject: `Your TikitiHub tickets for ${event?.name || "your event"}`,
      text: `Your booking ${booking.bookingReference} is confirmed. Ticket codes: ${tickets.map(ticket => ticket.ticketCode).join(", ")}. Keep these codes private and present them at event entry.`
    }], { session });
    return true;
  });
}

async function failPayment(payment, resultCode) {
  await runMongoTransaction(async session => {
    const paymentUpdate = await Payment.updateOne(
      { _id: payment._id, status: { $in: ["initiating", "pending"] } },
      { $set: { status: "failed", resultCode: String(resultCode), verifiedAt: new Date() } },
      { session }
    );
    if (paymentUpdate.modifiedCount !== 1) return;
    await Booking.updateOne(
      { _id: payment.booking, status: "reserved", paymentStatus: "pending" },
      { $set: { paymentInProgress: false } },
      { session }
    );
    const booking = await Booking.findById(payment.booking).select("bookingReference customerEmail").session(session);
    if (booking) await Notification.create([{
      type: "payment_failure",
      recipient: booking.customerEmail,
      subject: "TikitiHub payment was not completed",
      text: `Payment for booking ${booking.bookingReference} was not completed. You may retry while the reservation is active.`
    }], { session });
  });
  retryDueNotifications().catch(error => logError("Payment notification delivery failed:", error));
}

// Release inventory held by reservations whose checkout window has ended.
async function releaseExpiredReservations() {
  if (reservationCleanupRunning || !(await supportsMongoTransactions())) {
    return;
  }

  reservationCleanupRunning = true;

  try {
    const expiredBookings = await Booking.find({
      status: "reserved",
      reservationReleased: false,
      paymentInProgress: { $ne: true },
      expiresAt: { $lte: new Date() }
    })
      .select("_id event quantity")
      .limit(100);

    for (const booking of expiredBookings) {
      try {
        await runMongoTransaction(async session => {
          const claimedBooking = await Booking.findOneAndUpdate(
            {
              _id: booking._id,
              status: "reserved",
              reservationReleased: false,
              paymentInProgress: { $ne: true },
              expiresAt: { $lte: new Date() }
            },
            {
              $set: {
                status: "expired",
                reservationReleased: true
              }
            },
            { returnDocument: "after", session }
          );

          if (!claimedBooking) {
            return;
          }

          const inventoryUpdate = await Event.updateOne(
            {
              _id: claimedBooking.event,
              ticketsReserved: { $gte: claimedBooking.quantity }
            },
            { $inc: { ticketsReserved: -claimedBooking.quantity } },
            { session }
          );

          if (inventoryUpdate.modifiedCount !== 1) {
            throw new Error("Reserved ticket inventory is inconsistent.");
          }
        });
      } catch (error) {
        logError("Expired reservation processing error:", error);
      }
    }
  } finally {
    reservationCleanupRunning = false;
  }
}

// Home route
app.get("/", (req, res) => {
  res.json({
    message: "Welcome to TikitiHub API!",
    status: "running"
  });
});

// Register customer
app.post("/auth/register", authRateLimit, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !password ||
      name.trim().length > 120 ||
      email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return res.status(400).json({
        message: "Valid name, email and password are required."
      });
    }

    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({
        message: "Password must contain 12–72 UTF-8 bytes."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail
    });

    if (existingUser) {
      return res.status(409).json({
        message: "Email is already registered."
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = new User({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword
    });

    await user.save();

    res.status(201).json({
      message: "Registration successful!",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Email is already registered."
      });
    }

    logError("Registration error:", error);

    res.status(500).json({
      message: "Registration failed."
    });
  }
});

// Login
app.post("/auth/login", authRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        message: "Valid email and password are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await User.findOne({
      email: normalizedEmail
    });

    if (!user) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid email or password."
      });
    }

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        role: user.role,
        tokenVersion: user.tokenVersion
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1h"
      }
    );

    res.json({
      message: "Login successful!",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    logError("Login error:", error);

    res.status(500).json({
      message: "Login failed."
    });
  }
});

// Current account and password management
app.get("/users/me", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.userId).select("name email role phone organizerProfile createdAt");
  if (!user) return res.status(404).json({ message: "User not found." });
  return res.json({ user });
});

app.patch("/users/me", authenticateToken, async (req, res) => {
  const { name, phone } = req.body;
  if ((name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 120)) ||
      (phone !== undefined && (typeof phone !== "string" || phone.trim().length > 30))) {
    return res.status(400).json({ message: "Provide a valid name or phone number." });
  }
  const updates = {};
  if (name !== undefined) updates.name = name.trim();
  if (phone !== undefined) updates.phone = phone.trim();
  if (!Object.keys(updates).length) return res.status(400).json({ message: "No profile fields were provided." });
  const user = await User.findByIdAndUpdate(req.user.userId, { $set: updates }, { returnDocument: "after", runValidators: true })
    .select("name email role phone organizerProfile createdAt");
  return res.json({ user });
});

app.patch("/users/me/password", authenticateToken, authRateLimit, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 12 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({ message: "Current password and a new password of 12–72 UTF-8 bytes are required." });
  }
  const user = await User.findById(req.user.userId);
  if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
    return res.status(401).json({ message: "Current password is incorrect." });
  }
  user.password = await bcrypt.hash(newPassword, 12);
  user.tokenVersion += 1;
  await user.save();
  return res.json({ message: "Password updated. Please sign in again on your other devices." });
});

app.post("/auth/forgot-password", authRateLimit, async (req, res) => {
  const generic = { message: "If an account exists for that email, password reset instructions will be sent." };
  const { email } = req.body;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ message: "A valid email address is required." });
  }
  if (!process.env.FRONTEND_URL || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return res.status(503).json({ message: "Password reset email delivery is not configured." });
  }
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) return res.status(202).json(generic);
  const resetToken = crypto.randomBytes(32).toString("base64url");
  user.passwordResetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");
  user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();
  const resetUrl = new URL("/reset-password", process.env.FRONTEND_URL);
  resetUrl.searchParams.set("token", resetToken);
  await queueEmail({
    type: "password_reset",
    recipient: user.email,
    subject: "Reset your TikitiHub password",
    text: `Use this link within 30 minutes to reset your password: ${resetUrl.toString()}`,
    expiresAt: user.passwordResetExpiresAt
  });
  return res.status(202).json(generic);
});

app.post("/auth/reset-password", authRateLimit, async (req, res) => {
  const { token, password } = req.body;
  if (typeof token !== "string" || typeof password !== "string" || password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({ message: "A valid reset token and a password of 12–72 UTF-8 bytes are required." });
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({ passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } }).select("+passwordResetTokenHash +passwordResetExpiresAt");
  if (!user) return res.status(400).json({ message: "Password reset link is invalid or expired." });
  user.password = await bcrypt.hash(password, 12);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.tokenVersion += 1;
  await user.save();
  return res.json({ message: "Password reset successfully. Sign in with your new password." });
});

app.get("/users/me/bookings", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.userId).select("email");
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const filter = { customerEmail: user.email };
  const [total, bookings] = await Promise.all([
    Booking.countDocuments(filter),
    Booking.find(filter).select("-customerPhone").populate("event", "name date image").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ bookings, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.put("/organizer/me", authenticateToken, authorizeRoles("organizer"), async (req, res) => {
  const { organizationName, description, phone } = req.body;
  if ((organizationName !== undefined && (typeof organizationName !== "string" || !organizationName.trim() || organizationName.trim().length > 120)) ||
      (description !== undefined && (typeof description !== "string" || description.trim().length > 1000)) ||
      (phone !== undefined && (typeof phone !== "string" || phone.trim().length > 30))) {
    return res.status(400).json({ message: "Organizer profile fields are invalid." });
  }
  const user = await User.findById(req.user.userId);
  for (const [key, value] of Object.entries({ organizationName, description, phone })) {
    if (value !== undefined) user.organizerProfile[key] = value.trim();
  }
  await user.save();
  return res.json({ profile: user.organizerProfile });
});

app.get("/organizer/events", authenticateToken, authorizeRoles("organizer"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const filter = { organizer: req.user.userId };
  const [total, events] = await Promise.all([
    Event.countDocuments(filter),
    Event.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ events, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.get("/organizer/bookings", authenticateToken, authorizeRoles("organizer"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const ownEvents = await Event.find({ organizer: req.user.userId }).select("_id");
  const eventIds = ownEvents.map(event => event._id);
  const [total, bookings, totals] = await Promise.all([
    Booking.countDocuments({ event: { $in: eventIds } }),
    Booking.find({ event: { $in: eventIds } }).select("-customerPhone").populate("event", "name date").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    Booking.aggregate([
      { $match: { event: { $in: eventIds }, paymentStatus: "paid" } },
      { $group: { _id: null, sales: { $sum: "$totalAmount" }, tickets: { $sum: "$quantity" }, bookings: { $sum: 1 } } }
    ])
  ]);
  return res.json({ bookings, statistics: totals[0] || { sales: 0, tickets: 0, bookings: 0 }, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

// Submit an organizer application
app.post(
  "/organizer/applications",
  authenticateToken,
  authorizeRoles("customer"),
  async (req, res) => {
    try {
      const { organizationName, description, phone } = req.body;

      if (
        typeof organizationName !== "string" ||
        typeof description !== "string" ||
        typeof phone !== "string" ||
        !organizationName.trim() ||
        !description.trim() ||
        !phone.trim()
      ) {
        return res.status(400).json({
          message: "Organization name, description and phone are required."
        });
      }

      if (
        organizationName.trim().length > 120 ||
        description.trim().length > 1000 ||
        phone.trim().length > 20
      ) {
        return res.status(400).json({
          message: "One or more fields exceed the allowed length."
        });
      }

      let application = await OrganizerApplication.findOne({
        applicant: req.user.userId
      });

      if (application && application.status === "pending") {
        return res.status(409).json({
          message: "You already have a pending application."
        });
      }

      if (application && application.status === "approved") {
        return res.status(409).json({
          message: "You are already an approved organizer."
        });
      }

      // Allow a rejected applicant to apply again
      if (application) {
        application.organizationName = organizationName.trim();
        application.description = description.trim();
        application.phone = phone.trim();
        application.status = "pending";
        application.reviewedBy = null;
        application.reviewedAt = null;
        application.rejectionReason = null;
      } else {
        application = new OrganizerApplication({
          applicant: req.user.userId,
          organizationName: organizationName.trim(),
          description: description.trim(),
          phone: phone.trim()
        });
      }

      await application.save();

      res.status(201).json({
        message: "Organizer application submitted successfully.",
        application
      });

    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({
          message: "An organizer application already exists."
        });
      }

      logError("Organizer application error:", error);

      res.status(500).json({
        message: "Could not submit organizer application."
      });
    }
  }
);

// Check the logged-in user's organizer application
app.get(
  "/organizer/applications/me",
  authenticateToken,
  async (req, res) => {
    try {
      const application = await OrganizerApplication.findOne({
        applicant: req.user.userId
      });

      if (!application) {
        return res.status(404).json({
          message: "You have not submitted an organizer application."
        });
      }

      res.json({ application });

    } catch (error) {
      logError("Application retrieval error:", error);

      res.status(500).json({
        message: "Could not retrieve your application."
      });
    }
  }
);

// Create event with Cloudinary image upload
app.post(
  "/events",
  authenticateToken,
  authorizeRoles("organizer", "admin"),
  upload.single("image"),
  upload.validateImage,
  async (req, res) => {
    let uploadedImage;

    try {
      const validationError = validateEventInput(req.body);

      if (validationError) {
        return res.status(400).json({
          message: validationError
        });
      }

      if (new Date(req.body.date) <= new Date()) {
        return res.status(400).json({
          message: "Event date must be in the future."
        });
      }

      if (!req.file) {
        return res.status(400).json({
          message: "An event poster image is required."
        });
      }

      uploadedImage = await uploadImage(req.file.buffer);

      const event = new Event({
        name: req.body.name.trim(),
        description: req.body.description.trim(),
        location: req.body.location.trim(),
        date: new Date(req.body.date),
        price: Number(req.body.price),
        capacity: Number(req.body.capacity),
        image: uploadedImage.url,
        imagePublicId: uploadedImage.publicId,
        organizer: req.user.userId,
        status: "pending"
      });

      await event.save();

      res.status(201).json({
        message: "Event created successfully. Awaiting admin approval.",
        event
      });

    } catch (error) {
      if (uploadedImage) {
        await cloudinary.uploader.destroy(uploadedImage.publicId)
          .catch(cleanupError => {
            logError("Image cleanup error:", cleanupError);
          });
      }

      logError("Event creation error:", error);

      res.status(500).json({
        message: "Event creation failed."
      });
    }
  }
);

// Reserve tickets for an approved event. Guest details are used for checkout.
app.post("/bookings", async (req, res) => {
  try {
    const {
      eventId,
      customerName,
      customerEmail,
      customerPhone,
      quantity
    } = req.body;

    if (!isValidId(eventId)) {
      return res.status(400).json({ message: "A valid event ID is required." });
    }

    if (
      typeof customerName !== "string" ||
      !customerName.trim() ||
      customerName.trim().length > 120 ||
      typeof customerEmail !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim()) ||
      customerEmail.trim().length > 254 ||
      typeof customerPhone !== "string" ||
      !customerPhone.trim() ||
      customerPhone.trim().length > 30
    ) {
      return res.status(400).json({
        message: "Valid customer name, email and phone are required."
      });
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return res.status(400).json({
        message: "Ticket quantity must be a whole number between 1 and 10."
      });
    }

    if (!(await supportsMongoTransactions())) {
      return res.status(503).json({
        message: "Booking requires MongoDB replica set transaction support."
      });
    }

    await releaseExpiredReservations();

    const bookingReference = `TH-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
    const expiresAt = new Date(Date.now() + RESERVATION_MINUTES * 60 * 1000);

    // Inventory and its booking record commit or roll back together.
    const booking = await runMongoTransaction(async session => {
      const reservedEvent = await Event.findOneAndUpdate(
        {
          _id: eventId,
          status: "approved",
          date: { $gt: new Date() },
          $expr: {
            $gte: [
              {
                $subtract: [
                  "$capacity",
                  {
                    $add: [
                      { $ifNull: ["$ticketsSold", 0] },
                      { $ifNull: ["$ticketsReserved", 0] }
                    ]
                  }
                ]
              },
              quantity
            ]
          }
        },
        { $inc: { ticketsReserved: quantity } },
        { returnDocument: "after", session }
      );

      if (!reservedEvent) {
        return null;
      }

      const [createdBooking] = await Booking.create([{
        bookingReference,
        event: reservedEvent._id,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim().toLowerCase(),
        customerPhone: customerPhone.trim(),
        quantity,
        unitPrice: reservedEvent.price,
        totalAmount: reservedEvent.price * quantity,
        expiresAt
      }], { session });

      return createdBooking;
    });

    if (!booking) {
      const eventExists = await Event.exists({
        _id: eventId,
        status: "approved",
        date: { $gt: new Date() }
      });

      return res.status(eventExists ? 409 : 404).json({
        message: eventExists
          ? "Not enough tickets are available."
          : "Approved upcoming event not found."
      });
    }

    return res.status(201).json({
      message: "Tickets reserved. Complete payment before the reservation expires.",
      booking: {
        bookingReference: booking.bookingReference,
        event: booking.event,
        quantity: booking.quantity,
        unitPrice: booking.unitPrice,
        totalAmount: booking.totalAmount,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        expiresAt: booking.expiresAt
      }
    });
  } catch (error) {
    logError("Booking reservation error:", error);
    const status = error.code === 20 ? 503 : 500;
    return res.status(status).json({
      message: status === 503
        ? "Booking requires MongoDB replica set transaction support."
        : "Could not reserve tickets."
    });
  }
});

// Initiate an M-Pesa STK Push for a guest reservation.
app.post("/payments/mpesa/initiate", bookingRateLimit, async (req, res) => {
  let payment;
  let idempotencyKey;
  try {
    const { bookingReference, email, phone } = req.body;
    idempotencyKey = req.get("Idempotency-Key");
    if (typeof bookingReference !== "string" || typeof email !== "string" || typeof phone !== "string" ||
        typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      return res.status(400).json({ message: "Booking reference, email, phone and an Idempotency-Key header are required." });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await Booking.findOne({ bookingReference, customerEmail: normalizedEmail });
    if (!existing) return res.status(404).json({ message: "Active booking not found." });

    const previousPayment = await Payment.findOne({ idempotencyKey });
    if (previousPayment) {
      if (!previousPayment.booking.equals(existing._id)) return res.status(409).json({ message: "Idempotency key has already been used." });
      return res.status(200).json({ payment: { status: previousPayment.status, checkoutRequestId: previousPayment.checkoutRequestId } });
    }

    const amount = existing.totalAmount;
    if (!Number.isSafeInteger(amount) || amount < 1) {
      return res.status(400).json({ message: "M-Pesa supports whole KES amounts of at least KES 1." });
    }
    if (!(await supportsMongoTransactions())) {
      return res.status(503).json({ message: "Payment requires MongoDB replica set transaction support." });
    }
    daraja.getConfig();
    const normalizedPhone = daraja.normalizeKenyanPhone(phone);

    await runMongoTransaction(async session => {
      const lockedBooking = await Booking.findOneAndUpdate(
        { _id: existing._id, status: "reserved", paymentStatus: "pending", paymentInProgress: { $ne: true }, reservationReleased: false, expiresAt: { $gt: new Date() } },
        { $set: { paymentInProgress: true } },
        { returnDocument: "after", session }
      );
      if (!lockedBooking) throw Object.assign(new Error("Reservation is no longer available for payment."), { status: 409 });
      [payment] = await Payment.create([{
        booking: lockedBooking._id,
        provider: "daraja",
        idempotencyKey,
        phoneNumber: normalizedPhone,
        amount
      }], { session });
    });

    const result = await daraja.initiateStkPush({
      phone,
      amount,
      accountReference: existing.bookingReference,
      description: "TikitiHub tickets"
    });
    if (result.ResponseCode !== "0" || !result.CheckoutRequestID) {
      await failPayment(payment, result.ResponseCode || "initiation_failed");
      return res.status(502).json({ message: "M-Pesa did not accept the payment request." });
    }

    payment.status = "pending";
    payment.merchantRequestId = result.MerchantRequestID || null;
    payment.checkoutRequestId = result.CheckoutRequestID;
    await payment.save();
    return res.status(202).json({
      message: "M-Pesa payment request sent. Complete the prompt on your phone.",
      payment: { status: payment.status, checkoutRequestId: payment.checkoutRequestId, customerMessage: result.CustomerMessage || null }
    });
  } catch (error) {
    if (payment && payment.status === "initiating") {
      await failPayment(payment, "initiation_error").catch(recoveryError => {
        logError("Payment initiation recovery failed:", recoveryError);
      });
    }
    if ((error.code === 11000 || error.status === 409) && typeof idempotencyKey === "string") {
      const [priorPayment, requestedBooking] = await Promise.all([
        Payment.findOne({ idempotencyKey }),
        Booking.findOne({ bookingReference: req.body.bookingReference, customerEmail: String(req.body.email || "").trim().toLowerCase() }).select("_id")
      ]);
      if (priorPayment && requestedBooking && priorPayment.booking.equals(requestedBooking._id)) {
        return res.status(200).json({ payment: { status: priorPayment.status, checkoutRequestId: priorPayment.checkoutRequestId } });
      }
      return res.status(409).json({ message: "This payment request was already processed." });
    }
    const status = error.status || (error.code === "DARAJA_CONFIGURATION" ? 503 : error.code === "INVALID_PHONE" ? 400 : 500);
    if (status >= 500) logError("M-Pesa initiation failed:", error);
    return res.status(status).json({ message: status === 400 || status === 409 ? error.message : "Could not start M-Pesa payment." });
  }
});

// Daraja callback: the callback is checked against Daraja's server-side STK query before fulfillment.
app.post("/payments/mpesa/callback", async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) return res.status(400).json({ message: "Invalid payment callback." });
    const payment = await Payment.findOne({ checkoutRequestId: callback.CheckoutRequestID });
    if (!payment) return res.status(202).json({ message: "Payment request is still being recorded. Daraja may retry this callback." });
    if (payment.status === "paid" || payment.status === "failed") return res.json({ ResultCode: 0, ResultDesc: "Callback already processed." });

    const verification = await daraja.queryStkPush(payment.checkoutRequestId);
    if (String(verification.ResponseCode) !== "0") return res.status(202).json({ message: "Daraja has not completed payment verification." });
    if (String(verification.ResultCode) !== "0") {
      await failPayment(payment, verification.ResultCode || callback.ResultCode || "failed");
      return res.json({ ResultCode: 0, ResultDesc: "Verified payment failure recorded." });
    }
    if (String(callback.ResultCode) !== "0") return res.status(202).json({ message: "Daraja confirms payment; awaiting its successful callback details." });

    const items = callback.CallbackMetadata?.Item;
    const metadata = Object.fromEntries((Array.isArray(items) ? items : []).map(item => [item.Name, item.Value]));
    const amount = Number(metadata.Amount);
    const receipt = typeof metadata.MpesaReceiptNumber === "string" ? metadata.MpesaReceiptNumber : "";
    if (amount !== payment.amount || !receipt) return res.status(400).json({ message: "Payment callback details do not match the request." });
    if (metadata.PhoneNumber !== undefined && daraja.normalizeKenyanPhone(String(metadata.PhoneNumber)) !== payment.phoneNumber) {
      return res.status(400).json({ message: "Payment callback phone does not match the request." });
    }
    await settleVerifiedPayment(payment._id, { amount, receipt });
    retryDueNotifications().catch(error => logError("Notification delivery failed:", error));
    return res.json({ ResultCode: 0, ResultDesc: "Payment verified and booking confirmed." });
  } catch (error) {
    logError("M-Pesa callback processing failed:", error);
    return res.status(500).json({ message: "Payment callback could not be processed." });
  }
});

// Check guest checkout progress without exposing customer data.
app.get("/payments/:bookingReference/status", bookingRateLimit, async (req, res) => {
  const { email } = req.query;
  if (typeof email !== "string") return res.status(400).json({ message: "Booking email is required." });
  const booking = await Booking.findOne({ bookingReference: req.params.bookingReference, customerEmail: email.trim().toLowerCase() }).select("status paymentStatus expiresAt");
  if (!booking) return res.status(404).json({ message: "Booking not found." });
  const payment = await Payment.findOne({ booking: booking._id }).sort({ createdAt: -1 }).select("status provider mpesaReceiptNumber createdAt");
  return res.json({ booking, payment });
});

app.get("/users/me/tickets", authenticateToken, async (req, res) => {
  const user = await User.findById(req.user.userId).select("email");
  const bookings = await Booking.find({ customerEmail: user.email, paymentStatus: "paid" }).select("_id");
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const ticketFilter = { booking: { $in: bookings.map(booking => booking._id) } };
  const [total, tickets] = await Promise.all([
    Ticket.countDocuments(ticketFilter),
    Ticket.find(ticketFilter)
      .populate("event", "name date location image")
      .select("ticketCode status checkedInAt event booking createdAt")
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  const ticketsWithQr = await Promise.all(tickets.map(async ticket => ({
    ...ticket.toObject(),
    qrCode: await QRCode.toDataURL(ticket.ticketCode, { errorCorrectionLevel: "M", margin: 1 })
  })));
  return res.json({ tickets: ticketsWithQr, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.post("/tickets/verify", authenticateToken, authorizeRoles("organizer", "admin"), async (req, res) => {
  const { ticketCode } = req.body;
  if (typeof ticketCode !== "string" || ticketCode.length < 20 || ticketCode.length > 100) {
    return res.status(400).json({ message: "A valid ticket code is required." });
  }
  const ticket = await Ticket.findOne({ ticketCode }).populate("event", "name date organizer");
  if (!ticket) return res.status(404).json({ message: "Ticket not found." });
  if (req.user.role === "organizer" && ticket.event.organizer.toString() !== req.user.userId) {
    return res.status(403).json({ message: "You cannot check in tickets for another organizer's event." });
  }
  if (ticket.status === "void") return res.status(410).json({ message: "Ticket has been cancelled." });
  const checkedIn = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: "valid" },
    { $set: { status: "used", checkedInAt: new Date(), checkedInBy: req.user.userId } },
    { returnDocument: "after" }
  );
  if (!checkedIn) return res.status(409).json({ message: "Ticket has already been used." });
  return res.json({ message: "Ticket verified and checked in.", ticket: { ticketCode: checkedIn.ticketCode, status: checkedIn.status, checkedInAt: checkedIn.checkedInAt, event: ticket.event } });
});

// Cancel an unpaid reservation and return its tickets to inventory.
app.post("/bookings/:reference/cancel", bookingRateLimit, async (req, res) => {
  try {
    const { email } = req.body;

    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ message: "Booking email is required." });
    }

    if (!(await supportsMongoTransactions())) {
      return res.status(503).json({
        message: "Booking requires MongoDB replica set transaction support."
      });
    }

    const booking = await runMongoTransaction(async session => {
      const cancelledBooking = await Booking.findOneAndUpdate(
        {
          bookingReference: req.params.reference,
          customerEmail: email.trim().toLowerCase(),
          status: "reserved",
          paymentStatus: "pending",
          paymentInProgress: { $ne: true },
          reservationReleased: false,
          expiresAt: { $gt: new Date() }
        },
        {
          $set: { status: "cancelled", reservationReleased: true }
        },
        { returnDocument: "after", session }
      );

      if (!cancelledBooking) {
        return null;
      }

      const inventoryUpdate = await Event.updateOne(
        {
          _id: cancelledBooking.event,
          ticketsReserved: { $gte: cancelledBooking.quantity }
        },
        { $inc: { ticketsReserved: -cancelledBooking.quantity } },
        { session }
      );

      if (inventoryUpdate.modifiedCount !== 1) {
        throw new Error("Reserved ticket inventory is inconsistent.");
      }

      return cancelledBooking;
    });

    if (!booking) {
      return res.status(404).json({
        message: "Active reservation not found for that booking reference and email."
      });
    }

    await safeQueueEmail({
      type: "booking_cancellation",
      recipient: booking.customerEmail,
      subject: "Your TikitiHub reservation was cancelled",
      text: `Reservation ${booking.bookingReference} was cancelled and the tickets were released.`
    });

    return res.json({
      message: "Reservation cancelled and tickets released.",
      bookingReference: booking.bookingReference,
      status: booking.status
    });
  } catch (error) {
    logError("Booking cancellation error:", error);
    const status = error.code === 20 ? 503 : 500;
    return res.status(status).json({
      message: status === 503
        ? "Booking requires MongoDB replica set transaction support."
        : "Could not cancel reservation."
    });
  }
});

// Search approved events
app.get("/events/search", async (req, res) => {
  try {
    const { location, maxPrice, minPrice, dateFrom, dateTo, q, sort } = req.query;

    const page = Math.max(
      1,
      parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 10)
    );

    const filter = {
      status: "approved",
      date: { $gt: new Date() }
    };

    if (location) {
      if (typeof location !== "string") {
        return res.status(400).json({ message: "Location must be a single string." });
      }
      filter.location = {
        $regex: escapeRegex(location),
        $options: "i"
      };
    }

    if (q !== undefined) {
      if (typeof q !== "string" || q.trim().length > 100) {
        return res.status(400).json({ message: "Search text must be at most 100 characters." });
      }
      const escapedQuery = escapeRegex(q.trim());
      filter.$or = [
        { name: { $regex: escapedQuery, $options: "i" } },
        { description: { $regex: escapedQuery, $options: "i" } }
      ];
    }

    const priceFilter = {};
    for (const [field, value] of [["minPrice", minPrice], ["maxPrice", maxPrice]]) {
      if (value !== undefined) {
        const parsedPrice = Number(value);
        if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
          return res.status(400).json({ message: `Please provide a valid ${field}.` });
        }
        priceFilter[field === "minPrice" ? "$gte" : "$lte"] = parsedPrice;
      }
    }
    if (Object.keys(priceFilter).length) {
      if (priceFilter.$gte !== undefined && priceFilter.$lte !== undefined && priceFilter.$gte > priceFilter.$lte) {
        return res.status(400).json({ message: "minPrice cannot exceed maxPrice." });
      }
      filter.price = priceFilter;
    }

    if (dateFrom !== undefined || dateTo !== undefined) {
      const dateFilter = {};
      for (const [field, value] of [["dateFrom", dateFrom], ["dateTo", dateTo]]) {
        if (value !== undefined) {
          const parsedDate = new Date(value);
          if (Number.isNaN(parsedDate.getTime())) {
            return res.status(400).json({ message: `Please provide a valid ${field}.` });
          }
          dateFilter[field === "dateFrom" ? "$gte" : "$lte"] = field === "dateFrom"
            ? new Date(Math.max(parsedDate.getTime(), Date.now()))
            : parsedDate;
        }
      }
      if (dateFilter.$gte && dateFilter.$lte && dateFilter.$gte > dateFilter.$lte) {
        return res.status(400).json({ message: "dateFrom cannot be later than dateTo." });
      }
      filter.date = { $gt: new Date(), ...dateFilter };
    }

    const sortOptions = {
      soonest: { date: 1 },
      latest: { date: -1 },
      price_asc: { price: 1, date: 1 },
      price_desc: { price: -1, date: 1 }
    };
    if (sort !== undefined && !Object.hasOwn(sortOptions, sort)) {
      return res.status(400).json({ message: "Unsupported sort order." });
    }

    const totalEvents = await Event.countDocuments(filter);

    const events = await Event.find(filter)
      .sort(sortOptions[sort] || sortOptions.soonest)
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      events,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalEvents / limit),
        totalEvents,
        limit
      }
    });

  } catch (error) {
    logError("Event search error:", error);

    res.status(500).json({
      message: "Event search failed."
    });
  }
});

// Get one approved upcoming event
app.get("/events/:id", async (req, res) => {
  try {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid event ID." });
    }

    const event = await Event.findOne({
      _id: req.params.id,
      status: "approved",
      date: { $gt: new Date() }
    });

    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    return res.json({ event });
  } catch (error) {
    logError("Event details error:", error);
    return res.status(500).json({ message: "Could not retrieve event." });
  }
});

// Get all approved events
app.get("/events", async (req, res) => {
  try {
    const page = Math.max(
      1,
      parseInt(req.query.page, 10) || 1
    );

    const limit = Math.min(
      50,
      Math.max(1, parseInt(req.query.limit, 10) || 10)
    );

    const filter = {
      status: "approved",
      date: { $gt: new Date() }
    };

    const totalEvents = await Event.countDocuments(filter);

    const events = await Event.find(filter)
      .sort({ date: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      events,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalEvents / limit),
        totalEvents,
        limit
      }
    });

  } catch (error) {
    logError("Event retrieval error:", error);

    res.status(500).json({
      message: "Could not retrieve events."
    });
  }
});

// Update event
app.put(
  "/events/:id",
  authenticateToken,
  authorizeRoles("organizer", "admin"),
  upload.single("image"),
  upload.validateImage,
  async (req, res) => {
    let uploadedImage;

    try {
      if (!isValidId(req.params.id)) {
        return res.status(400).json({
          message: "Invalid event ID."
        });
      }

      const event = await Event.findById(req.params.id);

      if (!event) {
        return res.status(404).json({
          message: "Event not found."
        });
      }

      if (!canManageEvent(event, req.user)) {
        return res.status(403).json({
          message: "You cannot manage another organizer's event."
        });
      }

      const allowedFields = [
        "name",
        "description",
        "location",
        "date",
        "price",
        "capacity"
      ];

      const updates = {};

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updates[field] = req.body[field];
        }
      }

      const mergedData = {
        name: updates.name ?? event.name,
        description: updates.description ?? event.description,
        location: updates.location ?? event.location,
        date: updates.date ?? event.date,
        price: updates.price ?? event.price,
        capacity: updates.capacity ?? event.capacity
      };

      const validationError = validateEventInput(mergedData);

      if (validationError) {
        return res.status(400).json({
          message: validationError
        });
      }

      if (updates.date !== undefined && new Date(updates.date) <= new Date()) {
        return res.status(400).json({
          message: "Event date must be in the future."
        });
      }

      const requestedCapacity = Number(mergedData.capacity);
      if (requestedCapacity < event.ticketsSold + event.ticketsReserved) {
        return res.status(409).json({
          message: "Capacity cannot be lower than tickets already sold or reserved."
        });
      }

      const oldImagePublicId = event.imagePublicId;

      if (req.file) {
        uploadedImage = await uploadImage(req.file.buffer);

        updates.image = uploadedImage.url;
        updates.imagePublicId = uploadedImage.publicId;
      }

      const eventUpdates = { ...updates };
      if (req.user.role === "organizer" && event.status === "approved") {
        Object.assign(eventUpdates, {
          status: "pending",
          reviewedBy: null,
          reviewedAt: null,
          rejectionReason: null
        });
      }

      const updatedEvent = await Event.findOneAndUpdate(
        {
          _id: event._id,
          $expr: {
            $gte: [
              requestedCapacity,
              { $add: [{ $ifNull: ["$ticketsSold", 0] }, { $ifNull: ["$ticketsReserved", 0] }] }
            ]
          }
        },
        { $set: eventUpdates },
        { returnDocument: "after", runValidators: true }
      );
      if (!updatedEvent) {
        if (uploadedImage) await cloudinary.uploader.destroy(uploadedImage.publicId)
          .catch(cleanupError => logError("Image cleanup error:", cleanupError));
        return res.status(409).json({ message: "Capacity cannot be lower than tickets already sold or reserved." });
      }

      if (uploadedImage && oldImagePublicId) {
        await cloudinary.uploader.destroy(oldImagePublicId)
          .catch(error => {
            logError("Old image deletion error:", error);
          });
      }

      res.json({
        message: "Event updated successfully.",
        event: updatedEvent
      });

    } catch (error) {
      if (uploadedImage) {
        await cloudinary.uploader.destroy(uploadedImage.publicId)
          .catch(cleanupError => {
            logError("Image cleanup error:", cleanupError);
          });
      }

      logError("Event update error:", error);

      res.status(500).json({
        message: "Event update failed."
      });
    }
  }
);

// Delete event
app.delete(
  "/events/:id",
  authenticateToken,
  authorizeRoles("organizer", "admin"),
  async (req, res) => {
    try {
      if (!isValidId(req.params.id)) {
        return res.status(400).json({
          message: "Invalid event ID."
        });
      }

      const event = await Event.findById(req.params.id);

      if (!event) {
        return res.status(404).json({
          message: "Event not found."
        });
      }

      if (!canManageEvent(event, req.user)) {
        return res.status(403).json({
          message: "You cannot delete another organizer's event."
        });
      }

      if (await Booking.exists({ event: event._id })) {
        return res.status(409).json({
          message: "Events with booking records cannot be deleted."
        });
      }

      await Event.findByIdAndDelete(event._id);

      await cloudinary.uploader.destroy(event.imagePublicId)
        .catch(error => {
          logError("Cloudinary image deletion error:", error);
        });

      res.json({
        message: "Event deleted successfully."
      });

    } catch (error) {
      logError("Event deletion error:", error);

      res.status(500).json({
        message: "Event deletion failed."
      });
    }
  }
);

// Get pending organizer applications
app.get("/admin/dashboard", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const [users, organizers, pendingApplications, events, pendingEvents, bookings, pendingPayments, sales, tickets] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: "organizer", isActive: true }),
    OrganizerApplication.countDocuments({ status: "pending" }),
    Event.countDocuments(),
    Event.countDocuments({ status: "pending" }),
    Booking.countDocuments(),
    Payment.countDocuments({ status: { $in: ["initiating", "pending"] } }),
    Payment.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } }]),
    Ticket.countDocuments({ status: "valid" })
  ]);
  return res.json({ statistics: { users, organizers, pendingApplications, events, pendingEvents, bookings, pendingPayments, validTickets: tickets, paymentSales: sales[0] || { count: 0, amount: 0 } } });
});

app.get("/admin/activity", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const [events, applications, bookings] = await Promise.all([
    Event.find().select("name status createdAt").sort({ createdAt: -1 }).limit(limit),
    OrganizerApplication.find().select("organizationName status createdAt reviewedAt").sort({ updatedAt: -1 }).limit(limit),
    Booking.find().select("bookingReference status paymentStatus totalAmount createdAt").sort({ createdAt: -1 }).limit(limit)
  ]);
  return res.json({ activity: [
    ...events.map(item => ({ type: "event", id: item._id, label: item.name, status: item.status, occurredAt: item.createdAt })),
    ...applications.map(item => ({ type: "organizer_application", id: item._id, label: item.organizationName, status: item.status, occurredAt: item.reviewedAt || item.createdAt })),
    ...bookings.map(item => ({ type: "booking", id: item._id, label: item.bookingReference, status: item.paymentStatus, occurredAt: item.createdAt }))
  ].sort((left, right) => right.occurredAt - left.occurredAt).slice(0, limit) });
});

app.get("/admin/users", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const filter = {};
  if (req.query.role !== undefined) {
    if (!["customer", "organizer", "admin"].includes(req.query.role)) return res.status(400).json({ message: "Invalid role filter." });
    filter.role = req.query.role;
  }
  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).select("name email role phone isActive createdAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ users, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.get("/admin/organizer-applications", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const filter = {};
  if (req.query.status !== undefined) {
    if (!["pending", "approved", "rejected"].includes(req.query.status)) return res.status(400).json({ message: "Invalid application status." });
    filter.status = req.query.status;
  }
  const [total, applications] = await Promise.all([
    OrganizerApplication.countDocuments(filter),
    OrganizerApplication.find(filter).populate("applicant", "name email").populate("reviewedBy", "name email")
      .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ applications, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.patch("/admin/users/:id", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid user ID." });
  const { role, isActive } = req.body;
  if ((role !== undefined && !["customer", "admin"].includes(role)) || (isActive !== undefined && typeof isActive !== "boolean")) {
    return res.status(400).json({ message: "Admins may set an account active or inactive, and assign customer or administrator roles. Organizer access requires application approval." });
  }
  if (req.params.id === req.user.userId && isActive === false) return res.status(409).json({ message: "You cannot deactivate your own administrator account." });
  if (req.params.id === req.user.userId && role !== undefined && role !== "admin") return res.status(409).json({ message: "You cannot remove your own administrator role." });
  const updates = {};
  if (role !== undefined) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;
  if (!Object.keys(updates).length) return res.status(400).json({ message: "No user changes were provided." });
  const user = await User.findByIdAndUpdate(req.params.id, { $set: updates, $inc: { tokenVersion: 1 } }, { returnDocument: "after", runValidators: true })
    .select("name email role phone isActive createdAt");
  if (!user) return res.status(404).json({ message: "User not found." });
  return res.json({ user });
});

app.get("/admin/bookings", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const filter = {};
  if (req.query.status !== undefined) {
    if (!["reserved", "confirmed", "cancelled", "expired"].includes(req.query.status)) return res.status(400).json({ message: "Invalid booking status." });
    filter.status = req.query.status;
  }
  const [total, bookings] = await Promise.all([
    Booking.countDocuments(filter),
    Booking.find(filter).populate("event", "name organizer date").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ bookings, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.get("/admin/events", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const filter = {};
  if (req.query.status !== undefined) {
    if (!["pending", "approved", "rejected"].includes(req.query.status)) return res.status(400).json({ message: "Invalid event status." });
    filter.status = req.query.status;
  }
  const [total, events] = await Promise.all([
    Event.countDocuments(filter),
    Event.find(filter).populate("organizer", "name email").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ events, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.get("/admin/tickets", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const filter = {};
  if (req.query.status !== undefined) {
    if (!["valid", "used", "void"].includes(req.query.status)) return res.status(400).json({ message: "Invalid ticket status." });
    filter.status = req.query.status;
  }
  const [total, tickets] = await Promise.all([
    Ticket.countDocuments(filter),
    Ticket.find(filter).populate("event", "name date").populate("booking", "bookingReference customerName").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ tickets, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.patch("/admin/tickets/:id/void", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid ticket ID." });
  const ticket = await Ticket.findOneAndUpdate({ _id: req.params.id, status: "valid" }, { $set: { status: "void" } }, { returnDocument: "after" });
  if (!ticket) return res.status(404).json({ message: "Valid ticket not found." });
  return res.json({ message: "Ticket invalidated.", ticket: { id: ticket._id, ticketCode: ticket.ticketCode, status: ticket.status } });
});

app.get("/admin/notifications", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const [total, notifications] = await Promise.all([
    Notification.countDocuments(),
    Notification.find().select("type recipient subject status attempts nextAttemptAt lastError createdAt updatedAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ notifications, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.post("/admin/notifications/:id/retry", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid notification ID." });
  const notification = await Notification.findOneAndUpdate({ _id: req.params.id, status: { $in: ["pending", "failed"] } }, {
    $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null }
  }, { returnDocument: "after" });
  if (!notification) return res.status(404).json({ message: "Retryable notification not found." });
  await retryDueNotifications();
  return res.json({ message: "Notification retry scheduled." });
});

app.get("/admin/payments", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const filter = {};
  if (req.query.status !== undefined) {
    if (!["initiating", "pending", "paid", "failed"].includes(req.query.status)) return res.status(400).json({ message: "Invalid payment status." });
    filter.status = req.query.status;
  }
  const [total, payments] = await Promise.all([
    Payment.countDocuments(filter),
    Payment.find(filter).populate({ path: "booking", select: "bookingReference status paymentStatus totalAmount" }).select("booking provider status amount checkoutRequestId mpesaReceiptNumber resultCode createdAt verifiedAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
  ]);
  return res.json({ payments, pagination: { currentPage: page, total, limit, totalPages: Math.ceil(total / limit) } });
});

app.post("/admin/payments/:id/reconcile", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(400).json({ message: "Invalid payment ID." });
  if (!(await supportsMongoTransactions())) return res.status(503).json({ message: "Payment reconciliation requires MongoDB replica set transaction support." });
  const payment = await Payment.findById(req.params.id);
  if (!payment) return res.status(404).json({ message: "Payment not found." });
  if (payment.status !== "pending" || !payment.checkoutRequestId) return res.status(409).json({ message: "Payment is not awaiting provider reconciliation." });
  try {
    const result = await daraja.queryStkPush(payment.checkoutRequestId);
    if (String(result.ResponseCode) !== "0") return res.status(202).json({ message: "Daraja has not completed verification. Retry reconciliation later." });
    if (String(result.ResultCode) === "0") {
      await settleVerifiedPayment(payment._id, { amount: payment.amount, receipt: null });
      retryDueNotifications().catch(error => logError("Notification delivery failed:", error));
      return res.json({ message: "Daraja confirmed payment; booking and tickets were reconciled." });
    }
    await failPayment(payment, result.ResultCode || "failed");
    return res.json({ message: "Daraja confirmed the payment failed; the reservation can expire or be retried." });
  } catch (error) {
    logError("Payment reconciliation failed:", error);
    return res.status(502).json({ message: "Daraja reconciliation is temporarily unavailable." });
  }
});

// Get pending organizer applications
app.get(
  "/admin/organizer-applications/pending",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const applications = await OrganizerApplication.find({
        status: "pending"
      })
        .populate("applicant", "name email")
        .sort({ createdAt: 1 });

      res.json({
        count: applications.length,
        applications
      });

    } catch (error) {
      logError("Pending applications error:", error);

      res.status(500).json({
        message: "Could not retrieve pending applications."
      });
    }
  }
);

// Approve an organizer application
app.patch(
  "/admin/organizer-applications/:id/approve",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return res.status(400).json({
          message: "Invalid application ID."
        });
      }

      const outcome = await runMongoTransaction(async session => {
        const application = await OrganizerApplication.findOneAndUpdate(
          { _id: id, status: "pending" },
          { $set: { status: "approved", reviewedBy: req.user.userId, reviewedAt: new Date(), rejectionReason: null } },
          { returnDocument: "after", runValidators: true, session }
        );
        if (!application) return { kind: "missing" };

        const user = await User.findOneAndUpdate(
          { _id: application.applicant, role: "customer", isActive: true },
          { $set: {
            role: "organizer",
            organizerProfile: {
              organizationName: application.organizationName,
              description: application.description,
              phone: application.phone
            }
          }, $inc: { tokenVersion: 1 } },
          { returnDocument: "after", session }
        );
        if (!user) throw Object.assign(new Error("Applicant could not be promoted. Check their current role."), { status: 409 });
        return { kind: "approved", application, user };
      });

      if (outcome.kind === "missing") return res.status(404).json({ message: "Pending application not found." });

      await safeQueueEmail({
        type: "organizer_application_approved",
        recipient: outcome.user.email,
        subject: "Your TikitiHub organizer application was approved",
        text: "Your organizer account is active. You can now create events from your TikitiHub account."
      });

      res.json({
        message: "Organizer application approved successfully.",
        application: outcome.application,
        user: { id: outcome.user._id, name: outcome.user.name, email: outcome.user.email, role: outcome.user.role }
      });

    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      logError("Application approval error:", error);

      res.status(500).json({
        message: "Application approval failed."
      });
    }
  }
);

// Reject an organizer application
app.patch(
  "/admin/organizer-applications/:id/reject",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!isValidId(id)) {
        return res.status(400).json({
          message: "Invalid application ID."
        });
      }

      if (
        typeof reason !== "string" ||
        !reason.trim() ||
        reason.trim().length > 1000
      ) {
        return res.status(400).json({
          message: "A rejection reason of 1–1000 characters is required."
        });
      }

      const application = await OrganizerApplication.findOneAndUpdate(
        {
          _id: id,
          status: "pending"
        },
        {
          $set: {
            status: "rejected",
            reviewedBy: req.user.userId,
            reviewedAt: new Date(),
            rejectionReason: reason.trim()
          }
        },
        {
          returnDocument: "after",
          runValidators: true
        }
      );

      if (!application) {
        return res.status(404).json({
          message: "Pending application not found."
        });
      }

      const applicant = await User.findById(application.applicant).select("email");
      if (applicant) await safeQueueEmail({
        type: "organizer_application_rejected",
        recipient: applicant.email,
        subject: "Update on your TikitiHub organizer application",
        text: `Your application was not approved. Reason: ${reason.trim()}`
      });

      res.json({
        message: "Organizer application rejected.",
        application
      });

    } catch (error) {
      logError("Application rejection error:", error);

      res.status(500).json({
        message: "Application rejection failed."
      });
    }
  }
);

// Get events awaiting administrator approval
app.get(
  "/admin/events/pending",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const events = await Event.find({
        status: "pending"
      })
        .populate("organizer", "name email")
        .sort({ createdAt: 1 });

      res.json({
        count: events.length,
        events
      });

    } catch (error) {
      logError("Pending events error:", error);

      res.status(500).json({
        message: "Could not retrieve pending events."
      });
    }
  }
);

// Approve an event
app.patch(
  "/admin/events/:id/approve",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return res.status(400).json({
          message: "Invalid event ID."
        });
      }

      const event = await Event.findOneAndUpdate(
        {
          _id: id,
          status: "pending"
        },
        {
          $set: {
            status: "approved",
            reviewedBy: req.user.userId,
            reviewedAt: new Date(),
            rejectionReason: null
          }
        },
        {
          returnDocument: "after",
          runValidators: true
        }
      );

      if (!event) {
        const existingEvent = await Event.findById(id);

        if (!existingEvent) {
          return res.status(404).json({
            message: "Event not found."
          });
        }

        return res.status(409).json({
          message: "This event has already been reviewed."
        });
      }

      const organizer = await User.findById(event.organizer).select("email");
      if (organizer) await safeQueueEmail({
        type: "event_approved",
        recipient: organizer.email,
        subject: "Your TikitiHub event was approved",
        text: `Your event “${event.name}” is approved and publicly available.`
      });

      res.json({
        message: "Event approved successfully.",
        event
      });

    } catch (error) {
      logError("Event approval error:", error);

      res.status(500).json({
        message: "Event approval failed."
      });
    }
  }
);

// Reject an event
app.patch(
  "/admin/events/:id/reject",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!isValidId(id)) {
        return res.status(400).json({
          message: "Invalid event ID."
        });
      }

      if (
        typeof reason !== "string" ||
        !reason.trim()
      ) {
        return res.status(400).json({
          message: "A rejection reason is required."
        });
      }

      if (reason.trim().length > 1000) {
        return res.status(400).json({
          message: "Rejection reason must not exceed 1000 characters."
        });
      }

      const event = await Event.findOneAndUpdate(
        {
          _id: id,
          status: "pending"
        },
        {
          $set: {
            status: "rejected",
            reviewedBy: req.user.userId,
            reviewedAt: new Date(),
            rejectionReason: reason.trim()
          }
        },
        {
          returnDocument: "after",
          runValidators: true
        }
      );

      if (!event) {
        const existingEvent = await Event.findById(id);

        if (!existingEvent) {
          return res.status(404).json({
            message: "Event not found."
          });
        }

        return res.status(409).json({
          message: "This event has already been reviewed."
        });
      }

      const organizer = await User.findById(event.organizer).select("email");
      if (organizer) await safeQueueEmail({
        type: "event_rejected",
        recipient: organizer.email,
        subject: "Update on your TikitiHub event",
        text: `Your event “${event.name}” was not approved. Reason: ${reason.trim()}`
      });

      res.json({
        message: "Event rejected successfully.",
        event
      });

    } catch (error) {
      logError("Event rejection error:", error);

      res.status(500).json({
        message: "Event rejection failed."
      });
    }
  }
);

// Handle upload and other errors
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message: error.code === "LIMIT_FILE_SIZE"
        ? "Image must not exceed 5 MB."
        : error.message
    });
  }

  if (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
    if (status >= 500) logError("Request failed:", error);
    return res.status(status).json({ message: status < 500 ? "Request could not be processed." : "An internal server error occurred." });
  }

  next();
});

app.use((req, res) => res.status(404).json({ message: "Route not found." }));

async function startServer() {
  await connectDB();
  const transactionsSupported = await supportsMongoTransactions();

  if (!transactionsSupported) {
    console.warn("MongoDB is running without replica set transaction support; payment and inventory routes will be unavailable.");
  }

  releaseExpiredReservations().catch(error => logError("Initial reservation cleanup failed:", error));
  retryDueNotifications().catch(error => logError("Initial notification delivery failed:", error));

  const reservationCleanupTimer = setInterval(() => {
    releaseExpiredReservations().catch(error => logError("Reservation cleanup failed:", error));
  }, RESERVATION_CLEANUP_INTERVAL_MS);
  reservationCleanupTimer.unref();

  const notificationRetryTimer = setInterval(() => {
    retryDueNotifications().catch(error => logError("Notification retry failed:", error));
  }, 60 * 1000);
  notificationRetryTimer.unref();

  return app.listen(PORT, () => console.log(`TikitiHub server running on port ${PORT}`));
}

if (require.main === module) {
  startServer().catch(error => {
    logError("Server startup failed:", error);
    process.exit(1);
  });
}

module.exports = { app, startServer };
