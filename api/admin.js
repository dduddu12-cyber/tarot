// api/admin.js
// GET  ?action=stats&kakaoId=   → 전체 통계
// GET  ?action=users&kakaoId=   → 유저 목록
// POST ?action=adjustCrystals   → 구슬 수동 조정

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url:   process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const ALLOWED_ORIGINS = ['https://tarot-beige-mu.vercel.app'];

const CATEGORIES = ['오늘의카드', '원카드', '궁합', '연애결혼', '직장취업', '재물투자', '고민상담', '고민상담미니', '심층분석'];
const PACKAGES   = ['starter', 'basic', 'premium', 'fullmoon'];

function getAdminIds() {
  return (process.env.ADMIN_KAKAO_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}

function getWelcomeInfo() {
  const eventEnd      = process.env.WELCOME_EVENT_END;
  const eventAmount   = parseInt(process.env.WELCOME_CRYSTALS_EVENT   || '20', 10);
  const defaultAmount = parseInt(process.env.WELCOME_CRYSTALS_DEFAULT || '5',  10);
  if (!eventEnd) return { isActive: false, amount: defaultAmount, eventEnd: null };
  const isActive = new Date() <= new Date(eventEnd + 'T23:59:59+09:00');
  return { isActive, amount: isActive ? eventAmount : defaultAmount, eventEnd };
}

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isAdmin(kakaoId) {
  return getAdminIds().includes(String(kakaoId || ''));
}

function todayKST() {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kakaoId = req.method === 'GET' ? req.query.kakaoId : req.body?.kakaoId;
  if (!isAdmin(kakaoId)) {
    return res.status(403).json({ error: '관리자만 접근 가능합니다.' });
  }

  const { action } = req.query;

  // ── GET stats ──────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'stats') {
    const today = todayKST();

    const [
      usersTotal, usersToday,
      readingsTotal, readingsToday,
      revenueTotal, revenueToday,
      referralsTotal,
      ...rest
    ] = await Promise.all([
      redis.get('stats:users:total'),
      redis.get(`stats:users:today:${today}`),
      redis.get('stats:readings:total'),
      redis.get(`stats:readings:today:${today}`),
      redis.get('stats:revenue:total'),
      redis.get(`stats:revenue:today:${today}`),
      redis.get('stats:referrals:total'),
      ...CATEGORIES.map(cat => redis.get(`stats:readings:cat:${cat}`)),
      ...PACKAGES.map(pkg => redis.get(`stats:revenue:pkg:${pkg}`)),
    ]);

    const catReadings = {};
    CATEGORIES.forEach((cat, i) => { catReadings[cat] = Number(rest[i] || 0); });

    const pkgRevenue = {};
    PACKAGES.forEach((pkg, i) => { pkgRevenue[pkg] = Number(rest[CATEGORIES.length + i] || 0); });

    return res.status(200).json({
      users:    { total: Number(usersTotal || 0), today: Number(usersToday || 0) },
      readings: { total: Number(readingsTotal || 0), today: Number(readingsToday || 0), byCategory: catReadings },
      revenue:  { total: Number(revenueTotal || 0), today: Number(revenueToday || 0), byPackage: pkgRevenue },
      referrals: { total: Number(referralsTotal || 0) },
      system:   getWelcomeInfo(),
    });
  }

  // ── GET users ──────────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'users') {
    const users = [];
    let cursor = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: 'user:*', count: 100 });
      cursor = Number(nextCursor);
      if (keys.length > 0) {
        const values = await Promise.all(keys.map(k => redis.get(k)));
        values.forEach(v => { if (v && v.kakaoId) users.push(v); });
      }
      if (users.length >= 500) break;
    } while (cursor !== 0);

    users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    return res.status(200).json({ users, total: users.length });
  }

  // ── POST adjustCrystals ────────────────────────────────────────────
  if (req.method === 'POST' && action === 'adjustCrystals') {
    const { targetKakaoId, amount, reason } = req.body || {};
    if (!targetKakaoId || amount === undefined) {
      return res.status(400).json({ error: 'targetKakaoId와 amount가 필요합니다.' });
    }
    const delta = parseInt(amount, 10);
    if (isNaN(delta)) return res.status(400).json({ error: 'amount는 정수여야 합니다.' });

    const key  = `user:${targetKakaoId}`;
    const user = await redis.get(key);
    if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });

    const updated = { ...user, crystals: Math.max(0, (user.crystals || 0) + delta) };
    await redis.set(key, updated);
    console.log(`[admin] 구슬 조정: ${targetKakaoId} ${delta > 0 ? '+' : ''}${delta}💎 (${reason || '수동'}) by ${kakaoId}`);

    return res.status(200).json({ success: true, crystals: updated.crystals });
  }

  return res.status(400).json({ error: '알 수 없는 action입니다.' });
}
