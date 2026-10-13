const { ADMIN_CHAT_ID, tg } = require('./_lib');

const STATUS = {
  accepted: { admin: '✅ Qabul qilindi', user: '✅ Buyurtmangiz #ID qabul qilindi va tayyorlanmoqda.' },
  delivered: { admin: '🚚 Yetkazildi', user: '🚚 Buyurtmangiz #ID yetkazildi. Xaridingiz uchun rahmat!' },
  cancelled: { admin: '❌ Bekor qilindi', user: '❌ Buyurtmangiz #ID bekor qilindi.' },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.status(401).end();

  const update = req.body || {};

  try {
    if (update.message && typeof update.message.text === 'string') {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text.startsWith('/start')) {
        await tg('sendMessage', {
          chat_id: chatId,
          text: "Salom! Do'konimizga xush kelibsiz 👋\nMahsulotlarni ko'rish uchun tugmani bosing.",
          reply_markup: {
            inline_keyboard: [[{ text: "🛍 Do'konni ochish", web_app: { url: `https://${req.headers.host}/` } }]],
          },
        });
      } else if (text.startsWith('/id')) {
        await tg('sendMessage', { chat_id: chatId, text: `Chat ID: ${chatId}` });
      }
    }

    // Admin buyurtma ostidagi tugmani bosganda mijozga xabar boradi
    const cq = update.callback_query;
    if (cq && cq.data && cq.data.startsWith('st:')) {
      const [, status, userId, orderId] = cq.data.split(':');
      const fromAdminChat = cq.message && String(cq.message.chat.id) === String(ADMIN_CHAT_ID);

      if (!fromAdminChat || !STATUS[status]) {
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: "Ruxsat yo'q" });
      } else {
        await tg('sendMessage', { chat_id: userId, text: STATUS[status].user.replace('ID', orderId) });
        await tg('sendMessage', {
          chat_id: cq.message.chat.id,
          text: `#${orderId}: ${STATUS[status].admin}`,
          reply_to_message_id: cq.message.message_id,
        });
        await tg('answerCallbackQuery', { callback_query_id: cq.id, text: STATUS[status].admin });
      }
    }
  } catch (e) {
    console.error(e);
  }

  // Telegram qayta-qayta yubormasligi uchun har doim 200
  res.status(200).json({ ok: true });
};
