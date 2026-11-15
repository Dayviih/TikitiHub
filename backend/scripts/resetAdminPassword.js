
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("../models/User");

// Read terminal input, hiding passwords when requested
function ask(question, hidden = false) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      return reject(new Error("Run this script directly in a terminal."));
    }

    let answer = "";

    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function restoreTerminal() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      process.stdout.write("\n");
    }

    function onData(char) {
      if (char === "\u0003") {
        restoreTerminal();
        reject(new Error("Operation cancelled."));
        return;
      }

      if (char === "\r" || char === "\n") {
        restoreTerminal();
        resolve(answer);
        return;
      }

      if (char === "\u007f" || char === "\b") {
        answer = answer.slice(0, -1);
        return;
      }

      if (char >= " ") {
        answer += char;

        if (!hidden) {
          process.stdout.write(char);
        }
      }
    }

    stdin.on("data", onData);
  });
}

// Reset an administrator's password
async function resetAdminPassword() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/tikitihub?replicaSet=rs0"
    );

    console.log("\nTikitiHub administrator password reset\n");

    const email = (await ask("Administrator email: "))
      .trim()
      .toLowerCase();

    const admin = await User.findOne({
      email,
      role: "admin"
    });

    if (!admin) {
      throw new Error("Administrator account not found.");
    }

    const password = await ask("New password: ", true);
    const confirmPassword = await ask("Confirm new password: ", true);

    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      throw new Error("Password must contain 12–72 UTF-8 bytes.");
    }

    if (password !== confirmPassword) {
      throw new Error("Passwords do not match.");
    }

    admin.password = await bcrypt.hash(password, 12);
    admin.tokenVersion += 1;
    await admin.save();

    console.log("\nAdministrator password updated successfully!");

  } catch (error) {
    console.error("\nPassword reset failed:", error.name || "Error");
    process.exitCode = 1;

  } finally {
    await mongoose.disconnect();
  }
}

resetAdminPassword();
