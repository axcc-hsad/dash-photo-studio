// ─────────────────────────────────────────────────────────────
//  chat.js  —  Netlify Function
//  POST { messages, lang }  →  { reply }
//  Uses Google Gemini Flash for DASH persona responses
// ─────────────────────────────────────────────────────────────
import { GoogleGenAI } from '@google/genai';

const SYSTEM_KO = `당신은 DASH Photo Studio의 AI 사진감독 에이전트입니다.
LG 제품 라이프스타일 이미지 제작을 위한 전문 어시스턴트로, 전문적이면서도 친근하게 안내합니다.
짧고 명확하게 답변하세요. 불필요한 설명은 하지 마세요.`;

const SYSTEM_EN = `You are DASH Photo Studio, an AI photo director agent.
You assist in creating LG product lifestyle images. Be professional, concise, and helpful.
Keep responses short and actionable.`;

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return cors204();
  if (event.httpMethod !== 'POST') return err(405, 'Method not allowed');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return err(500, 'GEMINI_API_KEY not set');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err(400, 'Invalid JSON'); }

  const { messages = [], lang = 'ko' } = body;
  if (!messages.length) return err(400, 'messages required');

  try {
    const ai = new GoogleGenAI({ apiKey });
    const systemPrompt = lang === 'ko' ? SYSTEM_KO : SYSTEM_EN;
    const lastMessage = messages[messages.length - 1];

    const res = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      config: { systemInstruction: systemPrompt },
      contents: lastMessage.content || lastMessage.text || '',
    });

    return ok({ reply: res.text || '' });
  } catch (e) {
    console.error('chat error:', e);
    return err(500, e.message);
  }
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
