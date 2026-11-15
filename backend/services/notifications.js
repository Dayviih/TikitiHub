const Notification = require("../models/Notification");

async function deliver(notification) {
  const claimed = await Notification.findOneAndUpdate(
    { _id: notification._id, status: "pending" },
    { $set: { status: "sending" } },
    { returnDocument: "after" }
  );
  if (!claimed) return false;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    await Notification.updateOne({ _id: notification._id }, {
      $set: { status: "pending", lastError: "Email delivery is not configured.", nextAttemptAt: new Date(Date.now() + 5 * 60 * 1000) },
      $inc: { attempts: 1 }
    });
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: notification.recipient, subject: notification.subject, text: notification.text }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
    await Notification.updateOne({ _id: notification._id }, { $set: { status: "sent", lastError: null }, $unset: { text: 1 }, $inc: { attempts: 1 } });
    return true;
  } catch (error) {
    const attempts = notification.attempts + 1;
    const retryDelay = Math.min(24 * 60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(attempts, 10)));
    await Notification.updateOne({ _id: notification._id }, {
      $set: {
        status: attempts >= 10 ? "failed" : "pending",
        lastError: error.message,
        nextAttemptAt: new Date(Date.now() + retryDelay)
      },
      $inc: { attempts: 1 }
    });
    return false;
  }
}

async function queueEmail({ type, recipient, subject, text, expiresAt }) {
  const notification = await Notification.create({ type, recipient, subject, text, expiresAt });
  await deliver(notification);
  return notification;
}

async function retryDueNotifications() {
  await Notification.updateMany(
    { status: "sending", updatedAt: { $lte: new Date(Date.now() - 5 * 60 * 1000) } },
    { $set: { status: "pending", nextAttemptAt: new Date() } }
  );
  const due = await Notification.find({ status: "pending", nextAttemptAt: { $lte: new Date() } })
    .select("+text")
    .sort({ createdAt: 1 })
    .limit(50);
  for (const notification of due) await deliver(notification);
}

module.exports = { queueEmail, retryDueNotifications };
