import { GoogleGenAI } from '@google/genai';
import { parseJsonObject } from '../server/request.js';

const DEFAULT_TOPIC_IDS = ['K0BlyZmn', 'BJ888R8J'];

function normalizeWebhookResult(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed || /^(accepted|error)$/i.test(trimmed)) {
    return null;
  }

  let jsonResult;
  try {
    jsonResult = JSON.parse(trimmed);
  } catch {
    jsonResult = { answer: trimmed };
  }

  if (!jsonResult || typeof jsonResult !== 'object' || Array.isArray(jsonResult) || jsonResult.error) return null;
  const finalAnswer = jsonResult.answer || jsonResult.output || jsonResult.message;
  if (typeof finalAnswer !== 'string' || !finalAnswer.trim() || /^(accepted|error)$/i.test(finalAnswer.trim())) {
    return null;
  }

  return { answer: finalAnswer.trim() };
}

async function generateAiFallback(question) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Server is missing GEMINI_API_KEY.');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 30000 } });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `总结关于"${question}"的高考知识点笔记。包含【核心概念】、【重点公式/结论】、【经典例题】。使用 Markdown。`,
  });

  return {
    source: 'AI',
    result: { answer: response.text || '搜索失败，请重试。' },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const body = parseJsonObject(req.body);
  const question = typeof body?.question === 'string' ? body.question.trim() : '';
  if (!question || question.length > 2000) {
    return res.status(400).json({ error: 'Question must contain 1–2000 characters.' });
  }

  if (process.env.WEBHOOK_URL) {
    try {
      const webhookResponse = await fetch(process.env.WEBHOOK_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
        headers: {
          ...(process.env.WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.WEBHOOK_TOKEN}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question, topic_ids: DEFAULT_TOPIC_IDS, deep_seek: true }),
      });

      if (webhookResponse.ok) {
        const normalized = normalizeWebhookResult(await webhookResponse.text());
        if (normalized) {
          return res.status(200).json({ source: '知识库', result: normalized });
        }
      }
    } catch {
      console.error('Webhook search failed.');
    }
  }

  try {
    const fallback = await generateAiFallback(question);
    return res.status(200).json(fallback);
  } catch {
    console.error('AI fallback failed.');
    return res.status(500).json({ error: '搜索失败，请检查服务端配置。' });
  }
}
