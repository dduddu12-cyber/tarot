// api/tarot.js
// Vercel 서버리스 함수: 프론트에서 /api/tarot 로 호출하면 여기로 들어옵니다.

export default async function handler(req, res) {
  // 1) POST 메서드만 허용
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST 메서드만 허용됩니다.' });
  }

  try {
    // 2) 프론트에서 보낸 데이터 꺼내기
    const { question, cards, name, birth } = req.body || {};

    if (!question) {
      return res.status(400).json({ error: 'question(질문)이 필요합니다.' });
    }

    // 3) 타로 리딩 프롬프트 만들기
    const prompt = `
    const prompt = `
당신은 노련한 타로 마스터입니다.

[질문자 정보]
- 이름: ${name || '익명'}
- 생년: ${birth || '비공개'}

[질문]
${question}

[카드 정보]
${JSON.stringify(cards || [])}

위 정보를 바탕으로,
1) 현재 상황
2) 마음/에너지 흐름
3) 앞으로의 흐름
4) 조언
형태로, 솔직하지만 따뜻하게 심층 리딩을 해주세요.
    `.trim();

    // 4) OpenAI Responses API 호출 (API 키는 환경변수에서 읽음)
    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 🔐 진짜 키 값은 코드에 안 쓰고, 환경변수에서만 읽습니다.
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini', // 필요하면 나중에 모델명 바꿀 수 있음
        input: prompt,
      }),
    });

    if (!openaiRes.ok) {
      const errorText = await openaiRes.text();
      console.error('OpenAI API 에러:', errorText);
      return res.status(500).json({ error: 'AI 리딩 호출 중 오류가 발생했습니다.' });
    }

    const data = await openaiRes.json();
    const reading = data.output[0].content[0].text;

    // 5) 프론트로 리딩 결과 응답
    return res.status(200).json({ reading });
  } catch (err) {
    console.error('서버 에러:', err);
    return res.status(500).json({ error: '서버 내부 오류가 발생했습니다.' });
  }
}
