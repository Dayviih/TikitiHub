const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true, index: true },
  recipient: { type: String, required: true },
  subject: { type: String, required: true },
  text: { type: String, required: true, select: false },
  status: { type: String, enum: ["pending", "sending", "sent", "failed"], default: "pending", index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lastError: { type: String, default: null },
  expiresAt: { type: Date, default: undefined }
}, { timestamps: true });

notificationSchema.index({ status: 1, nextAttemptAt: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
module.exports = mongoose.model("Notification", notificationSchema);
