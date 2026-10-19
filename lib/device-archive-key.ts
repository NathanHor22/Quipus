import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const keySchema = z.string().regex(/^[0-9a-f]{64}$/u);
function wrappingKey(secret: string): Buffer {
  if (Buffer.byteLength(secret, "utf8") < 32)
    throw new Error("Archive key protection is not configured.");
  return createHash("sha256").update("quipus:archive-key-wrap:v1\0").update(secret).digest();
}
export function wrapArchiveKey(
  key: string,
  ownerId: string,
  deviceId: string,
  secret: string,
): string {
  keySchema.parse(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey(secret), nonce);
  cipher.setAAD(Buffer.from("quipus:archive-key:v1:" + ownerId + ":" + deviceId));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(key, "hex")), cipher.final()]);
  return [
    "v1",
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}
export function unwrapArchiveKey(
  value: string,
  ownerId: string,
  deviceId: string,
  secret: string,
): string {
  try {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") throw new Error();
    const nonce = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length !== 32) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", wrappingKey(secret), nonce);
    cipher.setAAD(Buffer.from("quipus:archive-key:v1:" + ownerId + ":" + deviceId));
    cipher.setAuthTag(tag);
    return keySchema.parse(
      Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("hex"),
    );
  } catch {
    throw new Error("The device archive key could not be recovered.");
  }
}
