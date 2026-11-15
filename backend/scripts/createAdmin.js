
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const readline = require("readline");

const User = require("../models/User");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Read input without displaying passwords
function askHidden(question) {
  return new Promise(resolve => {
    process.stdout.write(question);

    const stdin = process.stdin;
    let answer = "";

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function onData(char) {
      if (char === "\u0003") {
        process.exit();
      }

      if (char === "\r" || char === "\n") {
        stdin.removeListener("data", onData);
        stdin.setRawMode(false);
        process.stdout.write("\n");
        resolve(answer);
        return;
      }

      if (char === "\u007f" || char === "\b") {
        answer = answer.slice(0, -1);
        return;
      }

      answer += char;
    }

    stdin.on("data", onData);
  });
}

// Read ordinary input
function ask(question) {
  return new Promise(resolve => {
    rl.question(question, answer => {
      resolve(answer.trim());
    });
  });
}

// Create the first administrator
async function createAdmin() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/tikitihub?replicaSet=rs0"
    );

    console.log("\nTikitiHub administrator setup\n");

    const existingAdmin = await User.findOne({
      role: "admin"
    });

    if (existingAdmin) {
      console.log("An administrator already exists.");
      console.log("Initial administrator setup is disabled.");

      return;
    }

    const name = await ask("Administrator name: ");
    const email = await ask("Administrator email: ");
    const password = await askHidden("Administrator password: ");
    const confirmPassword = await askHidden("Confirm password: ");

    if (!name || name.length > 120 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) {
      throw new Error("A name, valid email and password are required.");
    }

    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      throw new Error("Password must contain 12–72 UTF-8 bytes.");
    }

    if (password !== confirmPassword) {
      throw new Error("Passwords do not match.");
    }

    const normalizedEmail = email.toLowerCase();

    const existingUser = await User.findOne({
      email: normalizedEmail
    });

    if (existingUser) {
      throw new Error("This email is already registered.");
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const admin = new User({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: "admin"
    });

    await admin.save();

    console.log("\nAdministrator created successfully!");
    console.log("Role:", admin.role);

  } catch (error) {
    console.error("\nAdministrator setup failed:", error.name || "Error");
    process.exitCode = 1;

  } finally {
    rl.close();
    await mongoose.disconnect();
  }
}

createAdmin();
