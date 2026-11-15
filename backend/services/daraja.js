const crypto = require("crypto");

const API_ROOTS = {
  sandbox: "https://sandbox.safaricom.co.ke",
  production: "https://api.safaricom.co.ke"
};

function configurationError(message) {
  const error = new Error(message);
  error.code = "DARAJA_CONFIGURATION";
  return error;
}

function getConfig() {
  const environment = process.env.DARAJA_ENV || "sandbox";
  if (!API_ROOTS[environment]) throw configurationError("DARAJA_ENV must be sandbox or production.");
  const required = ["DARAJA_CONSUMER_KEY", "DARAJA_CONSUMER_SECRET", "DARAJA_SHORT_CODE", "DARAJA_PASSKEY", "DARAJA_CALLBACK_URL"];
  const missing = required.filter(key => !process.env[key]);
  if (missing.length) throw configurationError(`Daraja is not configured. Missing: ${missing.join(", ")}`);
  let callbackUrl;
  try {
    callbackUrl = new URL(process.env.DARAJA_CALLBACK_URL);
  } catch {
    throw configurationError("DARAJA_CALLBACK_URL must be a valid HTTPS URL.");
  }
  if (callbackUrl.protocol !== "https:") throw configurationError("DARAJA_CALLBACK_URL must use HTTPS.");
  return {
    DARAJA_CONSUMER_KEY: process.env.DARAJA_CONSUMER_KEY,
    DARAJA_CONSUMER_SECRET: process.env.DARAJA_CONSUMER_SECRET,
    DARAJA_SHORT_CODE: process.env.DARAJA_SHORT_CODE,
    DARAJA_PASSKEY: process.env.DARAJA_PASSKEY,
    DARAJA_CALLBACK_URL: callbackUrl.toString(),
    apiRoot: API_ROOTS[environment]
  };
}

function timestamp() {
  const date = new Date();
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function getAccessToken(config = getConfig()) {
  const credentials = Buffer.from(`${config.DARAJA_CONSUMER_KEY}:${config.DARAJA_CONSUMER_SECRET}`).toString("base64");
  const response = await fetch(`${config.apiRoot}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Daraja token request failed (${response.status}).`);
  const body = await response.json();
  if (!body.access_token) throw new Error("Daraja did not return an access token.");
  return body.access_token;
}

async function postJson(path, body, config = getConfig()) {
  const token = await getAccessToken(config);
  const response = await fetch(`${config.apiRoot}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Daraja request failed (${response.status}).`);
  return result;
}

function normalizeKenyanPhone(value) {
  const digits = String(value).replace(/[^0-9]/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  const error = new Error("Use a valid Kenyan mobile number.");
  error.code = "INVALID_PHONE";
  throw error;
}

async function initiateStkPush({ phone, amount, accountReference, description }) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("M-Pesa payment amount must be a whole number of KES.");
  const config = getConfig();
  const time = timestamp();
  const password = Buffer.from(`${config.DARAJA_SHORT_CODE}${config.DARAJA_PASSKEY}${time}`).toString("base64");
  return postJson("/mpesa/stkpush/v1/processrequest", {
    BusinessShortCode: config.DARAJA_SHORT_CODE,
    Password: password,
    Timestamp: time,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: normalizeKenyanPhone(phone),
    PartyB: config.DARAJA_SHORT_CODE,
    PhoneNumber: normalizeKenyanPhone(phone),
    CallBackURL: config.DARAJA_CALLBACK_URL,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: String(description).slice(0, 13)
  }, config);
}

async function queryStkPush(checkoutRequestId) {
  const config = getConfig();
  const time = timestamp();
  const password = Buffer.from(`${config.DARAJA_SHORT_CODE}${config.DARAJA_PASSKEY}${time}`).toString("base64");
  return postJson("/mpesa/stkpushquery/v1/query", {
    BusinessShortCode: config.DARAJA_SHORT_CODE,
    Password: password,
    Timestamp: time,
    CheckoutRequestID: checkoutRequestId
  }, config);
}

function newIdempotencyKey() {
  return crypto.randomUUID();
}

module.exports = { getConfig, initiateStkPush, queryStkPush, normalizeKenyanPhone, newIdempotencyKey };
