import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
export const newEmailToken = () => randomBytes(32).toString('base64url');
export function seal(value: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    createHash('sha256').update(secret).digest(),
    iv,
  );
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}
export function unseal<T>(value: string, secret: string): T {
  const data = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    createHash('sha256').update(secret).digest(),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      cipher.update(data.subarray(28)),
      cipher.final(),
    ]).toString(),
  ) as T;
}
