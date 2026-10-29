const crypto = require('crypto');
const ALGORITHM = 'aes-256-gcm';

// We need the key. I will just fetch it from the environment or .env file.
require('dotenv').config({ path: '../../.env' }); // Adjust if needed

const keyStr = process.env.CONNECTOR_ENCRYPTION_KEY;
if (!keyStr) {
  console.log("No key");
  process.exit(1);
}
const key = Buffer.from(keyStr, 'base64');

const encryptedData = 'bec49b02c27537e94ffd1ee5fcafbd07:077274f1a2d88ade725d31aa59b5f605:ea00d97ced8460c68468fc37bf5c0506b9bab948a96d25de4a64c0ae898ed7e384deeedd4567def2d65a45ffacd76875264578a1249e9c5a9f29ca2fcf38c5f9eec3e3cb6dcc3c21ae20e351df9b863ed2adb66d07fa227fd54d5c6087dd4aa6b93d7d63da995aa1e26b59e115cb3e85f8a6a1644c3bc5246a906e8e29720c19b94e194b891eec5b2d21257838d1273d590400ffd94b4f662219bfccf89ea5f12e94efd3b7ad342b5252ccabd5dc6141b272716c9f5ede01806fe330f633a3051e0e74f6ac207e33d9726d56d4ccfef8ac575815bd83625b2b1dc00aa009434fd5328e32d4c06a0041a62209ec306f21b86216eabc92cfd818b2cc9120e5';

const parts = encryptedData.split(':');
const [ivHex, authTagHex, encryptedTextHex] = parts;

const iv = Buffer.from(ivHex, 'hex');
const authTag = Buffer.from(authTagHex, 'hex');

const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
decipher.setAuthTag(authTag);

let decrypted = decipher.update(encryptedTextHex, 'hex', 'utf8');
decrypted += decipher.final('utf8');

console.log("Decrypted:", decrypted);
