const { getProducts } = require('./_lib');

const seedProducts = require('../products.json');

module.exports = async (req, res) => {
  let list;
  try {
    list = await getProducts();
  } catch (e) {
    console.error('DB read failed', e);
    list = seedProducts;
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(
    list.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      emoji: p.emoji,
      category: p.category,
      desc: p.desc,
      // Telegram rasmi bot tokeni ochilmasligi uchun o'zimizning /api/photo orqali beriladi
      image: p.photo ? `/api/photo?f=${encodeURIComponent(p.photo)}` : p.image,
    }))
  );
};
