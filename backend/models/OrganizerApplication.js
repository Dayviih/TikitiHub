
const mongoose = require("mongoose");

const organizerApplicationSchema = new mongoose.Schema({
  applicant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },

  organizationName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },

  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },

  phone: {
    type: String,
    required: true,
    trim: true
  },

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
    default: null
  }

}, {
  timestamps: true
});

module.exports = mongoose.model(
  "OrganizerApplication",
  organizerApplicationSchema
);
