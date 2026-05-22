// api/tarot.js
// 프론트에서 /api/tarot 로 호출하면, 여기서 클로드 API를 이용해 리딩을 만들어 줍니다.

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

    // 🔐 클로드 API 키 확인 (Vercel 환경 변수에서 읽음)
    const apiKey = process.env.AI_API_KEY; // Vercel에 설정한 Key 이름과 같아야 함
    if (!apiKey) {
      console.error('AI_API_KEY 환경 변수가 설정되지 않았습니다.');
      return res
        .status(500)
        .json({ error: '서버 설정 오류: AI_API_KEY가 없습니다.' });
    }

    // 3) 타로 리딩 프롬프트 만들기
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

    // 4) 클로드 Messages API 호출
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', // 사용 중인 모델명에 맞게 변경 가능
        max_tokens: 800,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errorText = await claudeRes.text();
      console.error('Claude API 에러:', errorText);
      return res
        .status(500)
        .json({ error: 'AI 리딩 호출 중 오류가 발생했습니다.' });
    }

    const data = await claudeRes.json();

    // 5) 클로드 응답에서 텍스트 꺼내기
    let reading = '';
    if (
      data &&
      Array.isArray(data.content) &&
      data.content[0] &&
      data.content[0].type === 'text'
    ) {
      reading = data.content[0].text;
    } else {
      console.error('예상치 못한 Claude 응답 형식:', JSON.stringify(data));
      return res
        .status(500)
        .json({ error: 'AI 리딩 응답 형식이 예상과 다릅니다.' });
    }

    // 6) 프론트로 리딩 결과 응답
    return res.status(200).json({ reading });
  } catch (err) {
    console.error('서버 에러:', err);
    return res
      .status(500)
      .json({ error: '서버 내부 오류가 발생했습니다.' });
  }
}
