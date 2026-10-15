const { BOT_TOKEN, ADMIN_CHAT_ID, hasDb, db } = require('./_lib');

// Sozlamalar joyidami — faqat "bor/yo'q" ko'rsatiladi, qiymatlarning o'zi emas
module.exports = async (req, res) => {
  let dbOk = false;
  if (hasDb) {
    try {
      const [pong] = await db([['PING']]);
      dbOk = pong === 'PONG';
    } catch (e) {
      console.error('DB ping failed', e);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    BOT_TOKEN: Boolean(BOT_TOKEN),
    ADMIN_CHAT_ID: Boolean(ADMIN_CHAT_ID),
    WEBHOOK_SECRET: Boolean(process.env.WEBHOOK_SECRET),
    database: hasDb ? (dbOk ? 'ulangan' : 'kalitlar bor, lekin javob yo\'q') : 'ulanmagan',
  });
};
