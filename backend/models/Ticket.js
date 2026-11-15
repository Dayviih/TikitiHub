const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema({
  ticketCode: { type: String, required: true, unique: true, index: true },
  booking: { type: mongoose.Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", required: true, index: true },
  status: { type: String, enum: ["valid", "used", "void"], default: "valid", index: true },
  checkedInAt: { type: Date, default: null },
  checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

module.exports = mongoose.model("Ticket", ticketSchema);
