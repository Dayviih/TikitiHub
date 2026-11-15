
const mongoose = require("mongoose");

const eventSchema = new mongoose.Schema({
  // Event details
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150
  },

  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 5000
  },

  location: {
    type: String,
    required: true,
    trim: true,
    maxlength: 250
  },

  date: {
    type: Date,
    required: true
  },

  // Ticket pricing in Kenyan shillings
  price: {
    type: Number,
    required: true,
    min: 0
  },

  // Maximum number of tickets available
  capacity: {
    type: Number,
    required: true,
    min: 1
  },

  // Tickets with successfully completed payments
  ticketsSold: {
    type: Number,
    default: 0,
    min: 0
  },

  // Tickets temporarily held by active reservations
  ticketsReserved: {
    type: Number,
    default: 0,
    min: 0
  },

  // Event poster
  image: {
    type: String,
    required: true
  },

  imagePublicId: {
    type: String,
    required: true
  },

  // Event organizer
  organizer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  // Event moderation
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },

  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null
  },

  reviewedAt: {
    type: Date,
    default: null
  },

  rejectionReason: {
    type: String,
    trim: true,
    default: null,
    maxlength: 1000
  }

}, {
  timestamps: true
});

// Calculate the number of tickets still available
eventSchema.index({ status: 1, date: 1 });
eventSchema.index({ organizer: 1, createdAt: -1 });

eventSchema.virtual("ticketsAvailable").get(function () {
  return this.capacity - this.ticketsSold - this.ticketsReserved;
});

module.exports = mongoose.model("Event", eventSchema);
