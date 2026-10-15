const {
  BOT_TOKEN, ADMIN_CHAT_ID, hasDb, tg, addProduct, removeProduct, isAdminUser, esc, money, verifyInitData,
} = require('./_lib');

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Rasmni admin chatiga yuborib, Telegram file_id sini olamiz — rasm Telegramda saqlanadi
async function uploadPhoto(dataUrl, caption) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return { error: "Rasm formati noto'g'ri" };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return { error: 'Rasm juda katta' };

  const form = new FormData();
  form.append('chat_id', String(ADMIN_CHAT_ID));
  form.append('caption', caption);
  form.append('photo', new Blob([buf], { type: `image/${m[1]}` }), `product.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, { method: 'POST', body: form });
  const out = await r.json();
  if (!out.ok) return { error: "Rasmni yuklab bo'lmadi" };
  return { fileId: out.result.photo[out.result.photo.length - 1].file_id };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const body = req.body || {};

  const user = verifyInitData(body.initData);
  if (!user || !(await isAdminUser(user.id))) return res.status(403).json({ error: "Ruxsat yo'q" });

  if (body.action === 'check') return res.status(200).json({ admin: true, db: hasDb });
  if (!hasDb) return res.status(503).json({ error: 'Baza ulanmagan' });

  if (body.action === 'add') {
    const name = clean(body.name, 60);
    const category = clean(body.category, 30);
    const desc = clean(body.desc, 120);
    const price = Number(body.price);
    if (!name || !category) return res.status(400).json({ error: 'Nomi va kategoriyasini yozing' });
    if (!Number.isInteger(price) || price <= 0 || price > 1e9) return res.status(400).json({ error: "Narx noto'g'ri" });

    let photo;
    const log = `➕ Ilovadan qo'shildi: ${name} — ${money(price)}`;
    if (body.photo) {
      const up = await uploadPhoto(body.photo, log);
      if (up.error) return res.status(400).json({ error: up.error });
      photo = up.fileId;
    } else {
      await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, text: esc(log), parse_mode: 'HTML' });
    }

    const product = await addProduct({ name, price, category, desc, photo });
    return res.status(200).json({ ok: true, id: product.id });
  }

  if (body.action === 'delete') {
    const removed = await removeProduct(Number(body.id));
    if (!removed) return res.status(404).json({ error: 'Mahsulot topilmadi' });
    return res.status(200).json({ ok: true });
  }

  res.status(400).json({ error: "Noma'lum amal" });
};
