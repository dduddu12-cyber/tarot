// api/tarot.js
// 프론트에서 /api/tarot 으로 POST { messages } 를 보내면,
// 서버에서 Claude API를 호출하고 { text, stop } 을 반환합니다.

const ALLOWED_ORIGINS = [
  'https://tarot-beige-mu.vercel.app',
  'https://dduddu12-cyber.github.io',
];

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(req, res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 메서드만 허용됩니다.' });
  }

  try {
    const { messages } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages 배열이 필요합니다.' });
    }

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
      console.error('AI_API_KEY 환경 변수가 설정되지 않았습니다.');
      return res.status(500).json({ error: '서버 설정 오류: AI_API_KEY가 없습니다.' });
    }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages,
      }),
    });

    if (!claudeRes.ok) {
      const errorData = await claudeRes.json().catch(() => ({}));
      const status = claudeRes.status;
      console.error('Claude API 에러:', status, errorData);
      return res.status(status).json({
        error: errorData.error?.message || `AI 리딩 호출 중 오류가 발생했습니다. (${status})`,
      });
    }

    const data = await claudeRes.json();
    const text = data.content?.[0]?.text || '';
    const stop = data.stop_reason || 'end_turn';

    return res.status(200).json({ text, stop });
  } catch (err) {
    console.error('서버 에러:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
}
