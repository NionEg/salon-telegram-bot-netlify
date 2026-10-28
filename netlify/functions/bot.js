const { google } = require("googleapis");

const TOKEN = process.env.TELEGRAM_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 200, body: "OK" };
  }

  try {
    const update = JSON.parse(event.body);

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || "";

      if (text === "/start") {
        await sendMainMenu(chatId, "Добро пожаловать в салон красоты! Выберите действие:");
      } else {
        await sendMainMenu(chatId, "Пожалуйста, используйте меню для навигации.");
      }
    }

    if (update.callback_query) {
      const callback = update.callback_query;
      await answerCallback(callback.id);
      await handleCallback(callback);
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 200, body: "OK" };
  }
};

async function handleCallback(callback) {
  const chatId = callback.message.chat.id;
  const messageId = callback.message.message_id;
  const data = callback.data;
  const user = callback.from;
  const sheets = await getSheets();

  if (data === "menu_main") {
    await editMessage(chatId, messageId, "Главное меню:", getMainMenuKeyboard());
  }

  else if (data === "menu_services") {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Услуги!A2:C",
    });
    const rows = res.data.values || [];
    let msg = "<b>💅 Наши услуги и цены:</b>\n\n";
    rows.forEach((r) => {
      if (r[0]) msg += `• <b>${escapeHtml(r[0])}</b> — ${escapeHtml(r[1])} (${escapeHtml(r[2])})\n`;
    });

    const keyboard = {
      inline_keyboard: [
        [{ text: "📅 Записаться", callback_data: "book_select_service" }],
        [{ text: "« Назад", callback_data: "menu_main" }],
      ],
    };
    await editMessage(chatId, messageId, msg, keyboard);
  }

  else if (data === "book_select_service") {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Услуги!A2:A",
    });
    const rows = res.data.values || [];
    const buttons = rows
      .map((r, i) => (r[0] ? [{ text: r[0], callback_data: `select_srv_${i + 2}` }] : null))
      .filter(Boolean);
    buttons.push([{ text: "« Отмена", callback_data: "menu_main" }]);

    await editMessage(chatId, messageId, "Шаг 1/2: Выберите услугу:", { inline_keyboard: buttons });
  }

  else if (data.startsWith("select_srv_")) {
    const srvRow = parseInt(data.replace("select_srv_", ""));
    const slotsRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Слоты!A2:D",
    });
    const slots = slotsRes.data.values || [];
    const buttons = [];

    slots.forEach((slot, idx) => {
      if (slot[3] === "Свободно") {
        const dateStr = formatDate(slot[0]);
        const timeStr = formatTime(slot[1]);
        const master = slot[2] || "";
        buttons.push([{
          text: `${dateStr} ${timeStr} (${master})`,
          callback_data: `confirm_${srvRow}_${idx + 2}`,
        }]);
      }
    });

    if (buttons.length === 0) {
      await editMessage(chatId, messageId, "К сожалению, сейчас нет свободных окошек.", {
        inline_keyboard: [[{ text: "« Назад", callback_data: "menu_main" }]],
      });
      return;
    }

    buttons.push([{ text: "« Отмена", callback_data: "menu_main" }]);
    await editMessage(chatId, messageId, "Шаг 2/2: Выберите удобное время:", { inline_keyboard: buttons });
  }

  else if (data.startsWith("confirm_")) {
    const parts = data.split("_");
    const srvRow = parseInt(parts[2]);
    const slotRow = parseInt(parts[3]);

    const slotRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Слоты!A${slotRow}:D${slotRow}`,
    });
    const slot = slotRes.data.values?.[0];
    if (!slot || slot[3] !== "Свободно") {
      await editMessage(chatId, messageId, "Извините, это время уже заняли!", {
        inline_keyboard: [[{ text: "Попробовать снова", callback_data: "book_select_service" }]],
      });
      return;
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Слоты!D${slotRow}`,
      valueInputOption: "RAW",
      resource: { values: [["Занято"]] },
    });

    const srvRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Услуги!A${srvRow}`,
    });
    const srvName = srvRes.data.values?.[0]?.[0] || "";

    const userName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const userContact = user.username ? `@${user.username}` : `ID: ${user.id}`;
    const slotDate = formatDate(slot[0]);
    const slotTime = formatTime(slot[1]);

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Записи!A:H",
      valueInputOption: "USER_ENTERED",
      resource: {
        values: [[
          user.id,
          userName,
          userContact,
          srvName,
          slotDate,
          slotTime,
          slot[2] || "",
          new Date().toISOString(),
        ]],
      },
    });

    const successMsg = `🎉 <b>Вы успешно записаны!</b>\n\n` +
      `🔹 <b>Услуга:</b> ${escapeHtml(srvName)}\n` +
      `📅 <b>Дата:</b> ${slotDate}\n` +
      `⏰ <b>Время:</b> ${slotTime}\n` +
      `👤 <b>Мастер:</b> ${escapeHtml(slot[2] || "")}\n\nЖдём вас!`;

    await editMessage(chatId, messageId, successMsg, {
      inline_keyboard: [[{ text: "В главное меню", callback_data: "menu_main" }]],
    });
  }
}

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "💅 Услуги и цены", callback_data: "menu_services" }],
      [{ text: "📅 Записаться на прием", callback_data: "book_select_service" }],
    ],
  };
}

async function sendMainMenu(chatId, text) {
  await sendApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    reply_markup: getMainMenuKeyboard(),
  });
}

async function editMessage(chatId, messageId, text, keyboard) {
  await sendApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

async function answerCallback(callbackId) {
  await sendApi("answerCallbackQuery", { callback_query_id: callbackId });
}

async function sendApi(method, payload) {
  await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function formatDate(val) {
  if (!val) return "";
  if (typeof val === "string" && val.includes(".")) return val;
  const d = new Date(val);
  if (isNaN(d)) return String(val);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getFullYear()}`;
}

function formatTime(val) {
  if (!val) return "";
  if (typeof val === "string" && val.includes(":")) return val.substring(0, 5);
  return String(val);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
