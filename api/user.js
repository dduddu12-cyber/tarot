// api/user.js
// GET  /api/user?kakaoId={id}              → 유저 조회 / 신규 생성
// PATCH /api/user                           → 수정구슬 차감·충전 { kakaoId, amount }
// POST  /api/user?action=applyReferral      → 추천 코드 적용 { kakaoId, referralCode }

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function getWelcomeCrystalsInfo() {
  const eventEnd      = process.env.WELCOME_EVENT_END;
  const eventAmount   = parseInt(process.env.WELCOME_CRYSTALS_EVENT   || '20', 10);
  const defaultAmount = parseInt(process.env.WELCOME_CRYSTALS_DEFAULT || '5',  10);
  if (!eventEnd) return { amount: defaultAmount, isActive: false };
  const now      = new Date();
  const end      = new Date(eventEnd + 'T23:59:59+09:00');
  const isActive = now <= end;
  return { amount: isActive ? eventAmount : defaultAmount, isActive };
}

function getAdminIds() {
  const raw = process.env.ADMIN_KAKAO_IDS || '';
  return raw.split(',').map(id => id.trim()).filter(Boolean);
}

function setCors(req, res) {
  const ALLOWED_ORIGINS = [
    'https://tarot-beige-mu.vercel.app',
  ];
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// 혼동 문자(0/O, 1/I) 제거한 문자셋
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function assignReferralCode(user) {
  let code = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = genCode();
    const existing  = await redis.get(`referral:${candidate}`);
    if (!existing) { code = candidate; break; }
  }
  if (!code) throw new Error('추천 코드 생성 실패 (충돌 10회 초과)');

  const updated = { ...user, referralCode: code };
  await redis.set(`user:${user.kakaoId}`, updated);
  await redis.set(`referral:${code}`, String(user.kakaoId));
  console.log(`[referral] 코드 발급: ${user.kakaoId} → ${code}`);
  return updated;
}

async function getOrCreateUser(kakaoId) {
  const key  = `user:${kakaoId}`;
  let   user = await redis.get(key);

  if (!user) {
    const welcome = getWelcomeCrystalsInfo().amount;
    console.log(`[user] 신규 유저 생성: ${kakaoId}, 웰컴 구슬: ${welcome}개`);
    user = {
      kakaoId,
      crystals:  welcome,
      createdAt: new Date().toISOString(),
    };
    await redis.set(key, user);

    const today = new Date().toISOString().slice(0, 10);
    await Promise.allSettled([
      redis.incr('stats:users:total'),
      redis.incr(`stats:users:today:${today}`),
    ]);
  }

  // 마이그레이션: referralCode 없으면 자동 발급
  if (!user.referralCode) {
    user = await assignReferralCode(user);
  }

  return user;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── GET: 유저 조회 / 신규 생성 ──────────────────────────────
  if (req.method === 'GET') {
    const { kakaoId } = req.query;
    if (!kakaoId) {
      return res.status(400).json({ error: 'kakaoId가 필요합니다.' });
    }

    const user       = await getOrCreateUser(kakaoId);
    const isAdmin    = getAdminIds().includes(String(kakaoId));
    const welcomeInfo = getWelcomeCrystalsInfo();

    return res.status(200).json({
      kakaoId:         user.kakaoId,
      crystals:        isAdmin ? 999 : user.crystals,
      isAdmin,
      createdAt:       user.createdAt,
      referralCode:    user.referralCode,
      referredBy:      user.referredBy || null,
      welcomeCrystals: welcomeInfo.amount,
      isEventActive:   welcomeInfo.isActive,
    });
  }

  // ── POST: 추천 코드 적용 ─────────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.query;

    if (action !== 'applyReferral') {
      return res.status(400).json({ error: '알 수 없는 action입니다.' });
    }

    const { kakaoId, referralCode } = req.body || {};
    if (!kakaoId || !referralCode) {
      return res.status(400).json({ error: 'kakaoId와 referralCode가 필요합니다.' });
    }

    const user = await getOrCreateUser(kakaoId);

    // 이미 추천인 있음
    if (user.referredBy) {
      return res.status(400).json({ error: '이미 추천 코드를 입력했어요.' });
    }

    const code       = String(referralCode).toUpperCase().trim();
    const referrerId = await redis.get(`referral:${code}`);

    if (!referrerId) {
      return res.status(400).json({ error: '유효하지 않은 코드예요.' });
    }
    if (String(referrerId) === String(kakaoId)) {
      return res.status(400).json({ error: '본인 코드는 사용할 수 없어요.' });
    }

    // 신규 유저 💎 3개 지급
    const updatedUser = { ...user, crystals: user.crystals + 3, referredBy: String(referrerId) };
    await redis.set(`user:${kakaoId}`, updatedUser);

    // 추천인 💎 5개 지급
    const referrer = await redis.get(`user:${referrerId}`);
    if (referrer) {
      await redis.set(`user:${referrerId}`, { ...referrer, crystals: referrer.crystals + 5 });
    }

    console.log(`[referral] ${kakaoId} 코드 ${code} 사용 → 본인 +3💎, 추천인 ${referrerId} +5💎`);
    await redis.incr('stats:referrals:total').catch(() => {});
    return res.status(200).json({ crystals: updatedUser.crystals, ok: true });
  }

  // ── PATCH: 수정구슬 차감 / 충전 ─────────────────────────────
  if (req.method === 'PATCH') {
    const { kakaoId, amount } = req.body || {};

    if (!kakaoId || amount === undefined || amount === null) {
      return res.status(400).json({ error: 'kakaoId와 amount가 필요합니다.' });
    }

    const parsedAmount = parseInt(amount, 10);
    if (isNaN(parsedAmount)) {
      return res.status(400).json({ error: 'amount는 정수여야 합니다.' });
    }

    const isAdmin = getAdminIds().includes(String(kakaoId));

    // 관리자는 차감 스킵 (충전은 그대로 처리)
    if (isAdmin && parsedAmount < 0) {
      const user = await getOrCreateUser(kakaoId);
      return res.status(200).json({ crystals: user.crystals });
    }

    const user = await getOrCreateUser(kakaoId);

    if (parsedAmount < 0 && user.crystals + parsedAmount < 0) {
      return res.status(402).json({
        error:    '수정구슬이 부족합니다.',
        crystals: user.crystals,
        required: Math.abs(parsedAmount),
      });
    }

    const updated = { ...user, crystals: user.crystals + parsedAmount };
    await redis.set(`user:${kakaoId}`, updated);

    return res.status(200).json({ crystals: updated.crystals });
  }

  return res.status(405).json({ error: '허용되지 않는 메서드입니다.' });
}
