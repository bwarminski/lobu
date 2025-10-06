import * as crypto from "node:crypto";

const IV_LENGTH = 12; // 96-bit nonce for AES-GCM

/**
 * Get encryption key from environment with validation
 *
 * IMPORTANT: The ENCRYPTION_KEY must be exactly 32 bytes (256 bits) for AES-256.
 * Generate a secure key using: `openssl rand -base64 32` or `openssl rand -hex 32`
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || "";
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required for secure operation"
    );
  }

  // Try to decode as base64 first (most common format)
  let keyBuffer: Buffer;
  try {
    keyBuffer = Buffer.from(key, "base64");
    if (keyBuffer.length === 32) {
      return keyBuffer;
    }
  } catch {
    // Not valid base64, try other formats
  }

  // Try as hex
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    keyBuffer = Buffer.from(key, "hex");
    if (keyBuffer.length === 32) {
      return keyBuffer;
    }
  }

  // Try as UTF-8 (for backward compatibility with existing keys)
  keyBuffer = Buffer.from(key, "utf8");
  if (keyBuffer.length === 32) {
    return keyBuffer;
  }

  throw new Error(
    `ENCRYPTION_KEY must be exactly 32 bytes (256 bits) when decoded, got ${keyBuffer.length} bytes. ` +
      `Generate a valid key with: openssl rand -base64 32`
  );
}

/**
 * Encrypt a string using AES-256-GCM
 */
export function encrypt(text: string): string {
  const encryptionKey = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a string encrypted with AES-256-GCM
 */
export function decrypt(text: string): string {
  const encryptionKey = getEncryptionKey();
  const parts = text.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[0]!, "hex");
  const tag = Buffer.from(parts[1]!, "hex");
  const encryptedText = Buffer.from(parts[2]!, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encryptedText),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
