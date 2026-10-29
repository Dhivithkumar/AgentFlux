import crypto from 'crypto';

// The key should be exactly 32 bytes (256 bits) for aes-256-gcm
// Typically loaded from CONNECTOR_ENCRYPTION_KEY
const ALGORITHM = 'aes-256-gcm';

export function encrypt(text: string): string {
  const keyStr = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error('CONNECTOR_ENCRYPTION_KEY is not defined in environment');
  }

  const key = Buffer.from(keyStr, 'base64');
  if (key.length !== 32) {
    throw new Error('CONNECTOR_ENCRYPTION_KEY must be exactly 32 bytes when decoded from base64');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();

  // Return formatted string: iv:authTag:encryptedText
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export function decrypt(encryptedData: string): string {
  const keyStr = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!keyStr) {
    throw new Error('CONNECTOR_ENCRYPTION_KEY is not defined in environment');
  }

  const key = Buffer.from(keyStr, 'base64');
  
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const [ivStr, authTagStr, encryptedText] = parts;
  
  // The old format used 16-byte IV encoded as 32 hex characters.
  // The new format uses 12-byte IV encoded as 16 base64 characters.
  const encoding = ivStr.length === 32 ? 'hex' : 'base64';
  
  const iv = Buffer.from(ivStr, encoding);
  const authTag = Buffer.from(authTagStr, encoding);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedText, encoding as BufferEncoding, 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
