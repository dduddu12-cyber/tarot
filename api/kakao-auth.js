// api/kakao-auth.js
// POST /api/kakao-auth { code, redirectUri }
// 카카오 인가 코드 → 액세스 토큰 → 유저 프로필(kakaoId, nickname) 반환

const ALLOWED_ORIGINS = [
  'https://tarot-beige-mu.vercel.app',
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
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 허용' });

  const { code, redirectUri } = req.body || {};
  if (!code || !redirectUri) {
    return res.status(400).json({ error: 'code와 redirectUri가 필요합니다.' });
  }

  const restApiKey = process.env.KAKAO_REST_API_KEY;
  if (!restApiKey) {
    console.error('[kakao-auth] KAKAO_REST_API_KEY 환경변수 없음');
    return res.status(500).json({ error: 'KAKAO_REST_API_KEY 환경변수 없음' });
  }

  // ── 수신 파라미터 전체 출력 ──────────────────────────────────
  console.log('[kakao-auth] === 요청 수신 ===');
  console.log('[kakao-auth] code (앞 20자):', code?.slice(0, 20));
  console.log('[kakao-auth] redirectUri:', redirectUri);
  console.log('[kakao-auth] restApiKey (앞 6자):', restApiKey?.slice(0, 6) + '...');

  // 1. 인가 코드 → 액세스 토큰
  const REDIRECT_URI = 'https://tarot-beige-mu.vercel.app/';
  const tokenParams = new URLSearchParams({
    grant_type:   'authorization_code',
    client_id:    restApiKey,
    redirect_uri: REDIRECT_URI,
    code,
  });

  // ── 카카오로 보내는 실제 요청 파라미터 출력 ──────────────────
  const bodyString = tokenParams.toString();
  console.log('[kakao-auth] === 카카오 토큰 요청 파라미터 ===');
  console.log('[kakao-auth] grant_type: authorization_code');
  console.log('[kakao-auth] client_id (앞 6자):', restApiKey?.slice(0, 6) + '...');
  console.log('[kakao-auth] redirect_uri (실제 전송값):', REDIRECT_URI);
  console.log('[kakao-auth] code (앞 20자):', code?.slice(0, 20));
  console.log('[kakao-auth] Content-Type: application/x-www-form-urlencoded;charset=utf-8');
  console.log('[kakao-auth] body string:', bodyString.replace(code, '***'));

  const tokenRes  = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: bodyString,
  });

  // ── 카카오 응답 전체 출력 ────────────────────────────────────
  const tokenData = await tokenRes.json();
  console.log('[kakao-auth] === 카카오 토큰 응답 ===');
  console.log('[kakao-auth] HTTP status:', tokenRes.status);
  console.log('[kakao-auth] 응답 전체:', JSON.stringify(tokenData));

  if (!tokenData.access_token) {
    console.error('[kakao-auth] 토큰 발급 실패 - error:', tokenData.error, '| error_code:', tokenData.error_code, '| error_description:', tokenData.error_description);
    return res.status(401).json({ error: '카카오 토큰 발급 실패', detail: tokenData });
  }

  // 2. 액세스 토큰 → 유저 프로필
  const profileRes = await fetch('https://kapi.kakao.com/v2/user/me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileRes.json();

  if (!profile.id) {
    return res.status(401).json({ error: '프로필 조회 실패' });
  }

  return res.status(200).json({
    kakaoId:  String(profile.id),
    nickname: profile.kakao_account?.profile?.nickname || '별빛 손님',
  });
}
