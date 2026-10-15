const {
  BOT_TOKEN, ADMIN_CHAT_ID, hasDb, tg, db, getProducts, money, esc, dayKey, orderText, statusKeyboard, verifyInitData,
} = require('./_lib');

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
  const products = await getProducts();
  const items = [];
  let total = 0;
  for (const item of body.items) {
    const product = products.find((p) => p.id === item.id);
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return res.status(400).json({ error: "Savatda noto'g'ri mahsulot" });
    }
    total += product.price * qty;
    items.push({ id: product.id, name: product.name, price: product.price, qty });
  }

  const order = {
    id: Date.now().toString(36).toUpperCase(),
    userId: user.id,
    username: user.username || '',
    name, phone, address, comment, items, total,
    status: 'new',
    createdAt: Date.now(),
  };

  const sent = await tg('sendMessage', {
    chat_id: ADMIN_CHAT_ID,
    text: orderText(order),
    parse_mode: 'HTML',
    reply_markup: statusKeyboard(order),
  });
  if (!sent.ok) return res.status(502).json({ error: "Buyurtmani yuborib bo'lmadi, qayta urinib ko'ring" });

  if (hasDb) {
    const day = dayKey(order.createdAt);
    try {
      await db([
        ['SET', `order:${order.id}`, JSON.stringify(order)],
        ['ZADD', 'orders', order.createdAt, order.id],
        ['HINCRBY', `stats:${day}`, 'count', 1],
        ['HINCRBY', `stats:${day}`, 'revenue', total],
        ['INCR', 'stats:count'],
        ['INCRBY', 'stats:revenue', total],
      ]);
    } catch (e) {
      // Buyurtma adminga yetib bordi, baza xatosi mijozni to'xtatmasin
      console.error('DB save failed', e);
    }
  }

  const lines = items.map((i) => `• ${esc(i.name)} × ${i.qty} — ${money(i.price * i.qty)}`).join('\n');
  await tg('sendMessage', {
    chat_id: user.id,
    text:
      `✅ <b>Buyurtmangiz #${order.id} qabul qilindi!</b>\n\n` +
      `${lines}\n\n<b>Jami: ${money(total)}</b>\n\nTez orada siz bilan bog'lanamiz.`,
    parse_mode: 'HTML',
  });

  res.status(200).json({ ok: true, orderId: order.id, total });
};
