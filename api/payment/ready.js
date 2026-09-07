// api/payment/ready.js
// POST /api/payment/ready { kakaoId, packageId }
// 카카오페이 결제 준비 → next_redirect_url + tid 반환

const ALLOWED_ORIGINS = ['https://tarot-beige-mu.vercel.app'];

const PACKAGES = {
  starter:  { name: '수정구슬 스타터 (12개)',  amount: 1000,  crystals: 12  },
  basic:    { name: '수정구슬 베이직 (38개)',  amount: 3000,  crystals: 38  },
  premium:  { name: '수정구슬 프리미엄 (70개)', amount: 5000,  crystals: 70  },
  fullmoon: { name: '수정구슬 풀문 (150개)',   amount: 10000, crystals: 150 },
};

const BASE_URL = 'https://tarot-beige-mu.vercel.app';

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

  const { kakaoId, packageId } = req.body || {};
  if (!kakaoId || !packageId) {
    return res.status(400).json({ error: 'kakaoId와 packageId가 필요합니다.' });
  }

  const pkg = PACKAGES[packageId];
  if (!pkg) {
    return res.status(400).json({ error: '유효하지 않은 packageId입니다.' });
  }

  const cid       = process.env.KAKAO_PAY_CID;
  const secretKey = process.env.KAKAO_PAY_SECRET_KEY;
  console.log('[payment/ready] KAKAO_PAY_CID:', cid);
  console.log('[payment/ready] KAKAO_PAY_SECRET_KEY 존재 여부:', !!secretKey);
  if (!cid || !secretKey) {
    return res.status(500).json({ error: '카카오페이 환경변수 없음' });
  }

  const orderId = `${kakaoId}_${packageId}_${Date.now()}`;

  try {
    const kakaoRes = await fetch('https://open-api.kakaopay.com/online/v1/payment/ready', {
      method: 'POST',
      headers: {
        'Authorization': `SECRET_KEY ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cid,
        partner_order_id: orderId,
        partner_user_id:  kakaoId,
        item_name:        pkg.name,
        quantity:         1,
        total_amount:     pkg.amount,
        tax_free_amount:  0,
        approval_url: `${BASE_URL}/?payment=success&packageId=${packageId}&orderId=${encodeURIComponent(orderId)}`,
        cancel_url:   `${BASE_URL}/?payment=cancel`,
        fail_url:     `${BASE_URL}/?payment=fail`,
      }),
    });

    const data = await kakaoRes.json();
    console.log('[payment/ready] 카카오페이 응답:', JSON.stringify(data));

    if (!data.tid) {
      return res.status(400).json({ error: '결제 준비 실패', detail: data });
    }

    return res.status(200).json({
      tid:                      data.tid,
      orderId,
      next_redirect_mobile_url: data.next_redirect_mobile_url,
      next_redirect_pc_url:     data.next_redirect_pc_url,
    });
  } catch (err) {
    console.error('[payment/ready] 오류:', err);
    return res.status(500).json({ error: '서버 오류', message: err.message });
  }
}
