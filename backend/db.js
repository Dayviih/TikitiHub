
const mongoose = require("mongoose");

async function connectDB() {
  const mongoUri =
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/tikitihub?replicaSet=rs0";

  await mongoose.connect(mongoUri);

  console.log("MongoDB connected successfully.");
  return mongoose.connection;
}

module.exports = connectDB;

