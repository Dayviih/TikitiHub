
const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema({
  // Unique reference given to each booking
  bookingReference: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },

  // Event being booked
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Event",
    required: true
  },

  // Customer details for guest checkout
  customerName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },

  customerEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    maxlength: 254
  },

  customerPhone: {
    type: String,
    required: true,
    trim: true
  },

  // Number of tickets requested
  quantity: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: Number.isInteger,
      message: "Ticket quantity must be a whole number."
    }
  },

  // Price per ticket when the reservation was made
  unitPrice: {
    type: Number,
    required: true,
    min: 0
  },

  // Total amount payable
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },

  // Booking lifecycle
  status: {
    type: String,
    enum: [
      "reserved",
      "confirmed",
      "cancelled",
      "expired"
    ],
    default: "reserved"
  },

  // Payment information
  paymentStatus: {
    type: String,
    enum: [
      "pending",
      "paid",
      "failed",
      "refunded"
    ],
    default: "pending"
  },

  paymentMethod: {
    type: String,
    enum: [
      "mpesa",
      "airtel_money",
      "card",
      "bank_transfer"
    ],
    default: null
  },

  paymentReference: {
    type: String,
    default: null,
    trim: true
  },

  // Reservation expiry
  expiresAt: {
    type: Date,
    required: true
  },

  // Prevent releasing the same reserved inventory twice
  reservationReleased: {
    type: Boolean,
    default: false
  },

  paymentInProgress: {
    type: Boolean,
    default: false
  }

}, {
  timestamps: true
});

// Find bookings belonging to an event
bookingSchema.index({
  event: 1,
  status: 1
});

// Find reservations that have expired
bookingSchema.index({
  status: 1,
  expiresAt: 1
});

// Find a customer's bookings
bookingSchema.index({
  customerEmail: 1,
  createdAt: -1
});

module.exports = mongoose.model("Booking", bookingSchema);
