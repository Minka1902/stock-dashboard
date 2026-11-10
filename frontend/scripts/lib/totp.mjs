import { createHmac } from "node:crypto";

// RFC 6238 with the authenticator-app defaults the backend uses (pyotp):
// HMAC-SHA1, 30-second steps, 6 digits, base32 secret.
const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(text) {
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const ch of text.replace(/[\s=]/g, "").toUpperCase()) {
    const index = BASE32.indexOf(ch);
    if (index < 0) throw new Error(`invalid base32 character "${ch}" in TOTP secret`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

export function totp(secret, nowMs = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / STEP_SECONDS)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}
