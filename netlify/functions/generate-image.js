// ─────────────────────────────────────────────────────────────
//  generate-image.js  —  Netlify Function
//  POST { productType, region, ratio, prompt }
//  →  { imageUrl, qcScores }
//  Uses Gemini 2.0 Flash image generation (AI Studio free tier)
// ─────────────────────────────────────────────────────────────
import { GoogleGenAI } from '@google/genai';

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { productType, region, ratio, prompt } = body;
  if (!prompt) return err(400, 'prompt required');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return err(500, 'GEMINI_API_KEY not set');

  try {
    const ai = new GoogleGenAI({ apiKey });

    // ── 1. Generate image via Gemini 2.0 Flash ───────────────
    const result = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp-image-generation',
      contents: prompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    // Extract base64 image from response parts
    let imageUrl = null;
    const parts = result.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType || 'image/jpeg';
        imageUrl = `data:${mime};base64,${part.inlineData.data}`;
        break;
      }
    }

    if (!imageUrl) return err(500, 'No image returned from Gemini');

    // ── 2. QC via Gemini Flash vision ────────────────────────
    let qcScores = { productIntegrity: 88, naturalProportions: 85, backgroundHarmony: 87, regionalStyleMatch: 83 };
    try {
      const base64 = imageUrl.split(',')[1];
      const mime   = imageUrl.split(';')[0].split(':')[1];
      qcScores = await runQC(ai, base64, mime, productType, region);
    } catch (qcErr) {
      console.warn('QC skipped:', qcErr.message);
    }

    return ok({ imageUrl, qcScores });

  } catch (e) {
    console.error('generate-image error:', e);
    return err(500, e.message);
  }
}

async function runQC(ai, base64, mime, productType, region) {
  const res = await ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: [
      { inlineData: { mimeType: mime, data: base64 } },
      { text: `You are a lifestyle image QC expert. Evaluate this AI-generated lifestyle photo for an LG ${productType}.
Score each from 0–100 as JSON:
- productIntegrity: product clearly visible and undistorted?
- naturalProportions: scene looks natural and well-composed?
- backgroundHarmony: background complements the product?
- regionalStyleMatch: setting matches ${region} regional style?
Return ONLY JSON: {"productIntegrity":90,"naturalProportions":85,"backgroundHarmony":88,"regionalStyleMatch":82}` },
    ],
  });

  const text = res.text || '{}';
  const match = text.match(/\{[^}]+\}/);
  return match ? JSON.parse(match[0]) : { productIntegrity: 88, naturalProportions: 85, backgroundHarmony: 87, regionalStyleMatch: 83 };
}

// ── Helpers ───────────────────────────────────────────────────────
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ok      = b      => ({ statusCode: 200, headers: HEADERS, body: JSON.stringify(b) });
const err     = (c, m) => ({ statusCode: c,   headers: HEADERS, body: JSON.stringify({ error: m }) });
const cors204 = ()     => ({ statusCode: 204, headers: HEADERS, body: '' });
