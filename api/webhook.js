const {
  ADMIN_CHAT_ID, hasDb, STATUS_LABEL, tg, db, esc, money, dayKey, orderText, statusKeyboard,
} = require('./_lib');

const USER_TEXT = {
  accepted: '✅ Buyurtmangiz #ID qabul qilindi va tayyorlanmoqda.',
  delivered: '🚚 Buyurtmangiz #ID yetkazildi. Xaridingiz uchun rahmat!',
  cancelled: '❌ Buyurtmangiz #ID bekor qilindi.',
};

const isAdminChat = (chatId) => String(chatId) === String(ADMIN_CHAT_ID);

const PANEL_TEXT = '🛠 <b>Admin panel</b>\n\nKerakli bo\'limni tanlang.';
const PANEL_KB = {
  inline_keyboard: [
    [{ text: '📊 Statistika', callback_data: 'adm:stats' }],
    [
      { text: '🆕 Yangi buyurtmalar', callback_data: 'adm:new' },
      { text: '📋 Oxirgi 10 ta', callback_data: 'adm:last' },
    ],
  ],
};
const BACK_KB = { inline_keyboard: [[{ text: '⬅️ Orqaga', callback_data: 'adm:home' }]] };
const NO_DB_TEXT =
  "🛠 <b>Admin panel</b>\n\nBaza hali ulanmagan, shuning uchun statistika va buyurtmalar ro'yxati ishlamaydi. " +
  "Buyurtmalar baribir shu chatga kelaveradi.";

function parseHash(flat) {
  const out = {};
  for (let i = 0; i < (flat || []).length; i += 2) out[flat[i]] = Number(flat[i + 1]);
  return out;
}

async function recentOrders(limit) {
  const [ids] = await db([['ZREVRANGE', 'orders', 0, limit - 1]]);
  if (!ids || !ids.length) return [];
  const [raw] = await db([['MGET', ...ids.map((id) => `order:${id}`)]]);
  return raw.filter(Boolean).map((s) => JSON.parse(s));
}

async function panelView(view) {
  if (!hasDb) return { text: NO_DB_TEXT, kb: undefined };
  if (view === 'home') return { text: PANEL_TEXT, kb: PANEL_KB };

  if (view === 'stats') {
    const [day, count, revenue] = await db([
      ['HGETALL', `stats:${dayKey()}`],
      ['GET', 'stats:count'],
      ['GET', 'stats:revenue'],
    ]);
    const today = parseHash(day);
    const text =
      '📊 <b>Statistika</b>\n\n' +
      `<b>Bugun:</b> ${today.count || 0} ta buyurtma, ${money(today.revenue || 0)}\n` +
      `<b>Jami:</b> ${Number(count) || 0} ta buyurtma, ${money(Number(revenue) || 0)}\n\n` +
      '<i>Bekor qilingan buyurtmalar summaga kirmaydi.</i>';
    return { text, kb: BACK_KB };
  }

  // 'new' yoki 'last'
  let orders = await recentOrders(view === 'new' ? 50 : 10);
  if (view === 'new') orders = orders.filter((o) => o.status === 'new').slice(0, 10);
  const title = view === 'new' ? '🆕 <b>Yangi buyurtmalar</b>' : '📋 <b>Oxirgi buyurtmalar</b>';
  if (!orders.length) return { text: `${title}\n\nHozircha buyurtma yo'q.`, kb: BACK_KB };

  const lines = orders.map(
    (o) => `#${o.id} · ${esc(o.name)} · ${money(o.total)} · ${STATUS_LABEL[o.status] || ''}`
  );
  const kb = {
    inline_keyboard: [
      ...orders.map((o) => [{ text: `#${o.id} · ${money(o.total)}`, callback_data: `adm:o:${o.id}` }]),
      ...BACK_KB.inline_keyboard,
    ],
  };
  return { text: `${title}\n\n${lines.join('\n')}\n\nBatafsil ko'rish uchun buyurtmani bosing.`, kb };
}

// Holat o'zgarganda bazadagi buyurtma va statistikani yangilaydi.
// Avvalgi holatni qaytaradi (baza bo'lmasa null).
async function saveStatus(orderId, status) {
  if (!hasDb) return null;
  const [raw] = await db([['GET', `order:${orderId}`]]);
  if (!raw) return null;
  const o = JSON.parse(raw);
  const prev = o.status;
  if (prev === status) return prev;

  o.status = status;
  const day = `stats:${dayKey(o.createdAt)}`;
  const cmds = [['SET', `order:${orderId}`, JSON.stringify(o)]];
  if (status === 'cancelled') {
    cmds.push(['HINCRBY', day, 'revenue', -o.total], ['INCRBY', 'stats:revenue', -o.total]);
  } else if (prev === 'cancelled') {
    cmds.push(['HINCRBY', day, 'revenue', o.total], ['INCRBY', 'stats:revenue', o.total]);
  }
  await db(cmds);
  return prev;
}

async function handleMessage(msg, host) {
  const chatId = msg.chat.id;
  const command = msg.text.split(/[\s@]/)[0];

  if (command === '/start') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: "Salom! Do'konimizga xush kelibsiz 👋\nMahsulotlarni ko'rish uchun tugmani bosing.",
      reply_markup: {
        inline_keyboard: [[{ text: "🛍 Do'konni ochish", web_app: { url: `https://${host}/` } }]],
      },
    });
  } else if (command === '/id') {
    await tg('sendMessage', { chat_id: chatId, text: `Chat ID: ${chatId}` });
  } else if (command === '/admin') {
    if (!isAdminChat(chatId)) {
      await tg('sendMessage', { chat_id: chatId, text: "Bu buyruq faqat admin uchun." });
      return;
    }
    const view = await panelView('home');
    await tg('sendMessage', { chat_id: chatId, text: view.text, parse_mode: 'HTML', reply_markup: view.kb });
  }
}

async function handleCallback(cq) {
  const data = cq.data || '';
  const chat = cq.message && cq.message.chat;
  if (!chat || !isAdminChat(chat.id)) {
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: "Ruxsat yo'q" });
    return;
  }

  // Admin buyurtma ostidagi holat tugmasini bosdi
  if (data.startsWith('st:')) {
    const [, status, userId, orderId] = data.split(':');
    if (!USER_TEXT[status]) return;

    const prev = await saveStatus(orderId, status);
    if (prev === status) {
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `Allaqachon: ${STATUS_LABEL[status]}` });
      return;
    }
    await tg('sendMessage', { chat_id: userId, text: USER_TEXT[status].replace('ID', orderId) });
    await tg('sendMessage', {
      chat_id: chat.id,
      text: `#${orderId}: ${STATUS_LABEL[status]}`,
      reply_to_message_id: cq.message.message_id,
    });
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: STATUS_LABEL[status] });
    return;
  }

  if (data.startsWith('adm:o:')) {
    const orderId = data.slice(6);
    const [raw] = hasDb ? await db([['GET', `order:${orderId}`]]) : [null];
    if (!raw) {
      await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Buyurtma topilmadi' });
      return;
    }
    const o = JSON.parse(raw);
    await tg('sendMessage', { chat_id: chat.id, text: orderText(o), parse_mode: 'HTML', reply_markup: statusKeyboard(o) });
    await tg('answerCallbackQuery', { callback_query_id: cq.id });
    return;
  }

  if (data.startsWith('adm:')) {
    const view = await panelView(data.slice(4));
    await tg('editMessageText', {
      chat_id: chat.id,
      message_id: cq.message.message_id,
      text: view.text,
      parse_mode: 'HTML',
      reply_markup: view.kb,
    });
    await tg('answerCallbackQuery', { callback_query_id: cq.id });
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.status(401).end();

  const update = req.body || {};
  try {
    if (update.message && typeof update.message.text === 'string') {
      await handleMessage(update.message, req.headers.host);
    }
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
  } catch (e) {
    console.error(e);
  }

  // Telegram qayta-qayta yubormasligi uchun har doim 200
  res.status(200).json({ ok: true });
};
