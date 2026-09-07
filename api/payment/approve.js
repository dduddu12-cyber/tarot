// api/payment/approve.js
// POST /api/payment/approve { kakaoId, tid, pgToken, orderId, packageId }
// 카카오페이 결제 승인 → Upstash 구슬 충전 → 잔액 반환

import { Redis } from '@upstash/redis';

const ALLOWED_ORIGINS = ['https://tarot-beige-mu.vercel.app'];

const PACKAGES = {
  starter:  { crystals: 12,  price: 1000  },
  basic:    { crystals: 38,  price: 3000  },
  premium:  { crystals: 70,  price: 5000  },
  fullmoon: { crystals: 150, price: 10000 },
};

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

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

  const { kakaoId, tid, pgToken, orderId, packageId } = req.body || {};
  if (!kakaoId || !tid || !pgToken || !orderId || !packageId) {
    return res.status(400).json({ error: '필수 파라미터 누락' });
  }

  const pkg = PACKAGES[packageId];
  if (!pkg) {
    return res.status(400).json({ error: '유효하지 않은 packageId' });
  }

  const cid       = process.env.KAKAO_PAY_CID;
  const secretKey = process.env.KAKAO_PAY_SECRET_KEY;
  if (!cid || !secretKey) {
    return res.status(500).json({ error: '카카오페이 환경변수 없음' });
  }

  try {
    // 1. 카카오페이 결제 승인
    const kakaoRes = await fetch('https://open-api.kakaopay.com/online/v1/payment/approve', {
      method: 'POST',
      headers: {
        'Authorization': `SECRET_KEY ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cid,
        tid,
        partner_order_id: orderId,
        partner_user_id:  kakaoId,
        pg_token:         pgToken,
      }),
    });

    const data = await kakaoRes.json();
    console.log('[payment/approve] 카카오페이 응답:', JSON.stringify(data));

    if (!data.amount?.total) {
      return res.status(400).json({ error: '결제 승인 실패', detail: data });
    }

    // 2. Upstash 구슬 충전
    const key  = `user:${kakaoId}`;
    const user = await redis.get(key);
    const updated = {
      ...(user || { kakaoId, createdAt: new Date().toISOString() }),
      crystals: (user?.crystals || 0) + pkg.crystals,
    };
    await redis.set(key, updated);

    console.log(`[payment/approve] ${kakaoId} 구슬 ${pkg.crystals}개 충전 완료. 잔액: ${updated.crystals}`);

    // 매출 통계 기록
    const chargedAmount = data.amount?.total || pkg.price;
    const today = new Date().toISOString().slice(0, 10);
    await Promise.allSettled([
      redis.incrby('stats:revenue:total', chargedAmount),
      redis.incrby(`stats:revenue:today:${today}`, chargedAmount),
      redis.incr(`stats:revenue:pkg:${packageId}`),
    ]);

    return res.status(200).json({
      success:  true,
      crystals: updated.crystals,
      charged:  pkg.crystals,
    });
  } catch (err) {
    console.error('[payment/approve] 오류:', err);
    return res.status(500).json({ error: '서버 오류', message: err.message });
  }
}
