const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Booking",
    required: true,
    index: true
  },
  provider: {
    type: String,
    enum: ["daraja"],
    required: true
  },
  idempotencyKey: {
    type: String,
    required: true,
    unique: true
  },
  merchantRequestId: { type: String, default: null },
  checkoutRequestId: { type: String, default: undefined, unique: true, sparse: true },
  phoneNumber: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  status: {
    type: String,
    enum: ["initiating", "pending", "paid", "failed"],
    default: "initiating",
    index: true
  },
  resultCode: { type: String, default: null },
  mpesaReceiptNumber: { type: String, default: null },
  providerResult: { type: mongoose.Schema.Types.Mixed, default: null },
  verifiedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model("Payment", paymentSchema);
