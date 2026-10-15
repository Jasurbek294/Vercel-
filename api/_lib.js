const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

// Vercel Marketplace orqali ulangan Upstash Redis (admin panel uchun)
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const hasDb = Boolean(KV_URL && KV_TOKEN);

const STATUS_LABEL = {
  new: '🆕 Yangi',
  accepted: '✅ Qabul qilindi',
  delivered: '🚚 Yetkazildi',
  cancelled: '❌ Bekor qilindi',
};

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

// Bir nechta Redis buyrug'ini bitta so'rovda bajaradi
async function db(commands) {
  const r = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`DB ${r.status}`);
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error(x.error);
    return x.result;
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(n) {
  return Number(n).toLocaleString('ru-RU').replace(/,/g, ' ') + " so'm";
}

// Toshkent vaqti bo'yicha kun (statistika uchun)
function dayKey(ts = Date.now()) {
  return new Date(ts + 5 * 3600 * 1000).toISOString().slice(0, 10);
}

function orderText(o) {
  const lines = o.items.map((i) => `• ${esc(i.name)} × ${i.qty} — ${money(i.price * i.qty)}`).join('\n');
  const username = o.username ? ` (@${esc(o.username)})` : '';
  return (
    `🛒 <b>Buyurtma #${o.id}</b>\n\n` +
    `${lines}\n\n` +
    `<b>Jami: ${money(o.total)}</b>\n\n` +
    `👤 ${esc(o.name)}${username}\n` +
    `📞 ${esc(o.phone)}\n` +
    `📍 ${esc(o.address)}` +
    (o.comment ? `\n💬 ${esc(o.comment)}` : '') +
    `\n\nHolat: ${STATUS_LABEL[o.status] || STATUS_LABEL.new}`
  );
}

function statusKeyboard(o) {
  const cb = (status) => `st:${status}:${o.userId}:${o.id}`;
  return {
    inline_keyboard: [
      [
        { text: '✅ Qabul qilish', callback_data: cb('accepted') },
        { text: '🚚 Yetkazildi', callback_data: cb('delivered') },
      ],
      [{ text: '❌ Bekor qilish', callback_data: cb('cancelled') }],
    ],
  };
}

// Mini App yuborgan initData haqiqatan Telegramdan kelganini tekshiradi
function verifyInitData(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secret).update(checkString).digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

module.exports = {
  BOT_TOKEN, ADMIN_CHAT_ID, hasDb, STATUS_LABEL,
  tg, db, esc, money, dayKey, orderText, statusKeyboard, verifyInitData,
};
