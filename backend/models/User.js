const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },

  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    maxlength: 254
  },

  password: {
    type: String,
    required: true
  },

  phone: { type: String, default: null, trim: true, maxlength: 30 },
  organizerProfile: {
    type: new mongoose.Schema({
    organizationName: { type: String, default: null, trim: true, maxlength: 120 },
    description: { type: String, default: null, trim: true, maxlength: 1000 },
    phone: { type: String, default: null, trim: true, maxlength: 30 }
    }, { _id: false }),
    default: () => ({})
  },
  tokenVersion: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  passwordResetTokenHash: { type: String, default: null, select: false },
  passwordResetExpiresAt: { type: Date, default: null, select: false },

  role: {
    type: String,
    enum: ["customer", "organizer", "admin"],
    default: "customer"
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("User", userSchema);
