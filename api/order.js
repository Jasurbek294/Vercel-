const products = require('../products.json');
const { BOT_TOKEN, ADMIN_CHAT_ID, tg, esc, money, verifyInitData } = require('./_lib');

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return res.status(500).json({ error: 'Server sozlanmagan' });

  const body = req.body || {};
  const user = verifyInitData(body.initData);
  if (!user) return res.status(401).json({ error: "Do'konni Telegram ichida oching" });

  const name = clean(body.name, 100);
  const phone = clean(body.phone, 30);
  const address = clean(body.address, 300);
  const comment = clean(body.comment, 500);
  if (!name || !phone || !address) return res.status(400).json({ error: "Ism, telefon va manzilni to'ldiring" });

  // Narxlar faqat serverdagi products.json dan olinadi
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) {
    return res.status(400).json({ error: "Savat bo'sh" });
  }
  const lines = [];
  let total = 0;
  for (const item of body.items) {
    const product = products.find((p) => p.id === item.id);
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: "Savatda noto'g'ri mahsulot" });
    }
    total += product.price * qty;
    lines.push(`• ${esc(product.name)} × ${qty} — ${money(product.price * qty)}`);
  }

  const orderId = Date.now().toString(36).toUpperCase();
  const itemsText = lines.join('\n');
  const username = user.username ? ` (@${esc(user.username)})` : '';

  const adminText =
    `🛒 <b>Yangi buyurtma #${orderId}</b>\n\n` +
    `${itemsText}\n\n` +
    `<b>Jami: ${money(total)}</b>\n\n` +
    `👤 ${esc(name)}${username}\n` +
    `📞 ${esc(phone)}\n` +
    `📍 ${esc(address)}` +
    (comment ? `\n💬 ${esc(comment)}` : '');

  const cb = (status) => `st:${status}:${user.id}:${orderId}`;
  const sent = await tg('sendMessage', {
    chat_id: ADMIN_CHAT_ID,
    text: adminText,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Qabul qilish', callback_data: cb('accepted') },
          { text: '🚚 Yetkazildi', callback_data: cb('delivered') },
        ],
        [{ text: '❌ Bekor qilish', callback_data: cb('cancelled') }],
      ],
    },
  });
  if (!sent.ok) return res.status(502).json({ error: "Buyurtmani yuborib bo'lmadi, qayta urinib ko'ring" });

  await tg('sendMessage', {
    chat_id: user.id,
    text:
      `✅ <b>Buyurtmangiz #${orderId} qabul qilindi!</b>\n\n` +
      `${itemsText}\n\n<b>Jami: ${money(total)}</b>\n\nTez orada siz bilan bog'lanamiz.`,
    parse_mode: 'HTML',
  });

  res.status(200).json({ ok: true, orderId, total });
};
