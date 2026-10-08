import dotenv from 'dotenv';
import path from 'path';

// Calculate path to .env file relative to this file's location (__dirname is apps/api/src or apps/api/dist)
const envPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: envPath });

// Validate required environment variables
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'CONNECTOR_ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET'
];

const missing = requiredEnvVars.filter(key => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

const { validateAIConfiguration } = require('./config/ai');
validateAIConfiguration();

console.log('Environment loaded successfully.');
