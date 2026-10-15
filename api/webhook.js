const {
  ADMIN_CHAT_ID, hasDb, STATUS_LABEL,
  tg, db, getProducts, addProduct, removeProduct, esc, money, dayKey, orderText, statusKeyboard,
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
    [
      { text: "➕ Mahsulot qo'shish", callback_data: 'adm:add' },
      { text: '🗂 Mahsulotlar', callback_data: 'adm:prods' },
    ],
  ],
};
const BACK_KB = { inline_keyboard: [[{ text: '⬅️ Orqaga', callback_data: 'adm:home' }]] };
const NO_DB_TEXT =
  "🛠 <b>Admin panel</b>\n\nBaza hali ulanmagan, shuning uchun statistika, buyurtmalar ro'yxati va mahsulot qo'shish ishlamaydi. " +
  "Buyurtmalar baribir shu chatga kelaveradi.";

// Mahsulot qo'shish bosqichlari
const STEPS = ['name', 'price', 'category', 'desc', 'photo'];
const STEP_TEXT = {
  name: '1/5. Mahsulot <b>nomini</b> yozing:',
  price: "2/5. <b>Narxini</b> yozing (faqat raqam, so'mda). Masalan: <code>120000</code>",
  category: '3/5. <b>Kategoriyasini</b> yozing. Masalan: <code>Kiyim</code>',
  desc: "4/5. Qisqa <b>tavsif</b> yozing. O'tkazib yuborish uchun <code>-</code> yuboring.",
  photo: "5/5. Mahsulot <b>rasmini</b> yuboring. Rasmsiz qo'shish uchun <code>-</code> yuboring.",
};
const wizardKey = (chatId) => `wizard:${chatId}`;

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

  if (view === 'prods') {
    const products = await getProducts();
    if (!products.length) return { text: "🗂 <b>Mahsulotlar</b>\n\nDo'konda hozircha mahsulot yo'q.", kb: BACK_KB };
    const lines = products.map((p) => `• ${esc(p.name)} — ${money(p.price)}${p.category ? ` (${esc(p.category)})` : ''}`);
    const kb = {
      inline_keyboard: [
        ...products.map((p) => [{ text: `🗑 ${p.name}`.slice(0, 60), callback_data: `adm:del:${p.id}` }]),
        ...BACK_KB.inline_keyboard,
      ],
    };
    return {
      text: `🗂 <b>Mahsulotlar</b> (${products.length} ta)\n\n${lines.join('\n')}\n\nO'chirish uchun mahsulotni bosing.`,
      kb,
    };
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

function askStep(chatId, step, prefix = '') {
  return tg('sendMessage', {
    chat_id: chatId,
    text: `${prefix}${STEP_TEXT[step]}\n\n<i>Bekor qilish: /bekor</i>`,
    parse_mode: 'HTML',
    // Guruhda bot javobni ko'rishi uchun xabar botga "reply" qilib yuboriladi
    reply_markup: { force_reply: true },
  });
}

async function wizardStep(msg, w) {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const d = w.draft;

  if (w.step === 'name') {
    if (!text) return askStep(chatId, 'name');
    d.name = text.slice(0, 60);
  } else if (w.step === 'price') {
    const n = Number(text.replace(/[\s.,]/g, ''));
    if (!Number.isInteger(n) || n <= 0 || n > 1e9) return askStep(chatId, 'price', "⚠️ Narx noto'g'ri.\n");
    d.price = n;
  } else if (w.step === 'category') {
    if (!text) return askStep(chatId, 'category');
    d.category = text.slice(0, 30);
  } else if (w.step === 'desc') {
    if (!text) return askStep(chatId, 'desc');
    d.desc = text === '-' ? '' : text.slice(0, 120);
  } else if (w.step === 'photo') {
    if (msg.photo && msg.photo.length) d.photo = msg.photo[msg.photo.length - 1].file_id;
    else if (text !== '-') return askStep(chatId, 'photo', '⚠️ Rasm yuboring yoki <code>-</code> yozing.\n');
    return finishWizard(chatId, d);
  }

  w.step = STEPS[STEPS.indexOf(w.step) + 1];
  await db([['SET', wizardKey(chatId), JSON.stringify(w), 'EX', 3600]]);
  return askStep(chatId, w.step);
}

async function finishWizard(chatId, d) {
  const product = await addProduct(d);
  await db([['DEL', wizardKey(chatId)]]);

  await tg('sendMessage', {
    chat_id: chatId,
    text:
      `✅ <b>Mahsulot qo'shildi!</b>\n\n${esc(product.name)} — ${money(product.price)}\n` +
      `Kategoriya: ${esc(product.category)}${product.photo ? '\nRasm: bor' : ''}\n\n` +
      "Do'konni qayta ochsangiz, yangi mahsulot ko'rinadi.",
    parse_mode: 'HTML',
    reply_markup: PANEL_KB,
  });
}

async function handleMessage(msg, host) {
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const command = text.startsWith('/') ? text.split(/[\s@]/)[0] : '';

  if (command === '/start') {
    await tg('sendMessage', {
      chat_id: chatId,
      text: "Salom! Do'konimizga xush kelibsiz 👋\nMahsulotlarni ko'rish uchun tugmani bosing.",
      reply_markup: {
        inline_keyboard: [[{ text: "🛍 Do'konni ochish", web_app: { url: `https://${host}/` } }]],
      },
    });
    return;
  }
  if (command === '/id') {
    await tg('sendMessage', { chat_id: chatId, text: `Chat ID: ${chatId}` });
    return;
  }

  // Quyidagilarning hammasi faqat admin chatida ishlaydi
  if (!isAdminChat(chatId)) {
    if (command === '/admin') await tg('sendMessage', { chat_id: chatId, text: 'Bu buyruq faqat admin uchun.' });
    return;
  }

  if (command === '/admin') {
    const view = await panelView('home');
    await tg('sendMessage', { chat_id: chatId, text: view.text, parse_mode: 'HTML', reply_markup: view.kb });
    return;
  }
  if (!hasDb) return;

  if (command === '/bekor') {
    await db([['DEL', wizardKey(chatId)]]);
    await tg('sendMessage', { chat_id: chatId, text: "Mahsulot qo'shish bekor qilindi.", reply_markup: PANEL_KB });
    return;
  }

  // Mahsulot qo'shish jarayoni davom etayotgan bo'lsa, xabarni keyingi bosqich sifatida qabul qilamiz
  if (!command) {
    const [raw] = await db([['GET', wizardKey(chatId)]]);
    if (raw) await wizardStep(msg, JSON.parse(raw));
  }
}

async function handleCallback(cq) {
  const data = cq.data || '';
  const chat = cq.message && cq.message.chat;
  const answer = (text) => tg('answerCallbackQuery', { callback_query_id: cq.id, text });
  if (!chat || !isAdminChat(chat.id)) return answer("Ruxsat yo'q");

  // Admin buyurtma ostidagi holat tugmasini bosdi
  if (data.startsWith('st:')) {
    const [, status, userId, orderId] = data.split(':');
    if (!USER_TEXT[status]) return answer();

    const prev = await saveStatus(orderId, status);
    if (prev === status) return answer(`Allaqachon: ${STATUS_LABEL[status]}`);
    await tg('sendMessage', { chat_id: userId, text: USER_TEXT[status].replace('ID', orderId) });
    await tg('sendMessage', {
      chat_id: chat.id,
      text: `#${orderId}: ${STATUS_LABEL[status]}`,
      reply_to_message_id: cq.message.message_id,
    });
    return answer(STATUS_LABEL[status]);
  }

  if (!hasDb && data !== 'adm:home') return answer('Avval bazani ulang');

  if (data.startsWith('adm:o:')) {
    const [raw] = await db([['GET', `order:${data.slice(6)}`]]);
    if (!raw) return answer('Buyurtma topilmadi');
    const o = JSON.parse(raw);
    await tg('sendMessage', { chat_id: chat.id, text: orderText(o), parse_mode: 'HTML', reply_markup: statusKeyboard(o) });
    return answer();
  }

  if (data === 'adm:add') {
    await db([['SET', wizardKey(chat.id), JSON.stringify({ step: 'name', draft: {} }), 'EX', 3600]]);
    await askStep(chat.id, 'name', "➕ <b>Yangi mahsulot</b>\n\n");
    return answer();
  }

  const edit = (text, kb) =>
    tg('editMessageText', { chat_id: chat.id, message_id: cq.message.message_id, text, parse_mode: 'HTML', reply_markup: kb });

  // O'chirishdan oldin tasdiq so'raladi
  if (data.startsWith('adm:del:')) {
    const id = Number(data.slice(8));
    const p = (await getProducts()).find((x) => x.id === id);
    if (!p) return answer('Mahsulot topilmadi');
    await edit(`🗑 <b>${esc(p.name)}</b> (${money(p.price)}) do'kondan o'chirilsinmi?`, {
      inline_keyboard: [
        [{ text: "✅ Ha, o'chirish", callback_data: `adm:delok:${id}` }],
        [{ text: "⬅️ Yo'q", callback_data: 'adm:prods' }],
      ],
    });
    return answer();
  }

  if (data.startsWith('adm:delok:')) {
    await removeProduct(Number(data.slice(10)));
    const view = await panelView('prods');
    await edit(view.text, view.kb);
    return answer("O'chirildi");
  }

  if (data.startsWith('adm:')) {
    const view = await panelView(data.slice(4));
    await edit(view.text, view.kb);
    return answer();
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.status(401).end();

  const update = req.body || {};
  try {
    if (update.message) await handleMessage(update.message, req.headers.host);
    if (update.callback_query) await handleCallback(update.callback_query);
  } catch (e) {
    console.error(e);
  }

  // Telegram qayta-qayta yubormasligi uchun har doim 200
  res.status(200).json({ ok: true });
};
