const { BOT_TOKEN, tg, getProducts } = require('./_lib');

// Admin botga yuborgan mahsulot rasmini Telegramdan olib beradi
module.exports = async (req, res) => {
  const fileId = String((req.query && req.query.f) || '');
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return res.status(400).end();

  // Faqat mahsulotlarga tegishli rasmlar beriladi
  const products = await getProducts();
  if (!products.some((p) => p.photo === fileId)) return res.status(404).end();

  const info = await tg('getFile', { file_id: fileId });
  if (!info.ok) return res.status(404).end();

  const r = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`);
  if (!r.ok) return res.status(502).end();

  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
  res.status(200).end(Buffer.from(await r.arrayBuffer()));
};
