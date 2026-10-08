import { GoogleGenerativeAI } from '@google/generative-ai';
import * as dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'mock-key');

try {
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT" as any,
        properties: {
          result: { type: "STRING" as any }
        }
      }
    }
  });

  console.log("Model initialized.");
  model.generateContent("hello").then(() => console.log("Done")).catch(e => console.error("API error:", e.message));
} catch(e: any) {
  console.error("Sync error:", e.message);
}
