import { GoogleGenAI } from '@google/genai';
import { parseJsonObject } from '../server/request.js';

const ANALYZE_PROMPT = `你是一位专业的高考辅导老师。请分析这张图片中的题目：
1. 识别科目和知识点。
2. 给出详细的、分步骤的解答。
3. 用通俗易懂的语言解释核心概念。
4. 提供一个"提分技巧"。使用 Markdown 格式输出。`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Server is missing GEMINI_API_KEY.' });
  }

  const body = parseJsonObject(req.body);
  const imageDataUrl = typeof body?.imageDataUrl === 'string' ? body.imageDataUrl : '';
  if (imageDataUrl.length > 7 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image is too large (maximum 5 MiB).' });
  }
  const match = /^data:(image\/(?:png|jpeg|webp|gif|heic|heif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageDataUrl);
  if (!match || Buffer.from(match[2], 'base64').toString('base64') !== match[2]) {
    return res.status(400).json({ error: 'Expected a base64 image data URL.' });
  }
  const [, mimeType, base64Data] = match;
  if (Buffer.byteLength(base64Data, 'base64') > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'Image is too large (maximum 5 MiB).' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 30000 } });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: ANALYZE_PROMPT },
        ],
      },
    });

    return res.status(200).json({ analysis: response.text || '无法解析，请重试。' });
  } catch {
    console.error('Image analysis failed.');
    return res.status(500).json({ error: '分析失败，请稍后重试。' });
  }
}
