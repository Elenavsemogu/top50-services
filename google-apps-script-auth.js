// =====================================================
// TOP-50 SERVICES — AUTH BACKEND (Google Apps Script)
// Проверка подписки на канал + сбор лидов
// =====================================================
//
// НАСТРОЙКА:
// 1. Открой https://script.google.com/
// 2. Создай новый проект "Top50 Auth"
// 3. Скопируй весь этот код
// 4. Заполни CONFIG ниже
// 5. Deploy → New deployment → Web app
//    - Execute as: Me
//    - Who has access: Anyone
// 6. Скопируй URL деплоя и вставь в AUTH_CONFIG.SCRIPT_URL в index.html

const CONFIG = {
  BOT_TOKEN: 'YOUR_BOT_TOKEN',
  CHANNEL_ID: '@secreetroommedia',
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',
  SHEET_NAME: 'Top50 Leads',
  SECRET: 'top50_secret_key_change_me'
};

// ═══ GET handler (validate token, check session) ═══
function doGet(e) {
  const action = e.parameter.action;

  if (action === 'validate') {
    return handleValidateToken(e.parameter.token);
  }
  if (action === 'check') {
    return handleCheckSession(e.parameter.session);
  }

  return jsonResp({ success: false, message: 'Unknown action' });
}

// ═══ POST handler (register lead, bot webhook) ═══
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'register') {
      return handleRegister(data);
    }

    if (data.action === 'bot_auth') {
      return handleBotAuth(data);
    }

    return jsonResp({ success: false, message: 'Unknown action' });
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return jsonResp({ success: false, message: err.toString() });
  }
}

// ═══ Register via lead form ═══
function handleRegister(data) {
  const { name, telegram, timestamp, userAgent, source } = data;

  if (!name || !telegram) {
    return jsonResp({ success: false, message: 'Name and Telegram required' });
  }

  const session = generateSession(telegram);
  saveLead({
    name,
    telegram,
    method: 'lead_form',
    source: source || 'top50',
    timestamp: timestamp || new Date().toISOString(),
    userAgent: userAgent || '',
    session
  });

  return jsonResp({ success: true, session });
}

// ═══ Auth via Telegram bot (bot sends token) ═══
function handleBotAuth(data) {
  const { telegram_id, username, first_name, last_name } = data;

  if (!telegram_id) {
    return jsonResp({ success: false, message: 'No telegram_id' });
  }

  const isSubscribed = checkSubscription(telegram_id);
  if (!isSubscribed) {
    return jsonResp({ success: false, isSubscribed: false, message: 'Not subscribed' });
  }

  const token = generateToken(telegram_id);
  const session = generateSession(String(telegram_id));

  saveLead({
    name: [first_name, last_name].filter(Boolean).join(' '),
    telegram: username ? '@' + username : String(telegram_id),
    method: 'telegram_bot',
    source: 'top50',
    timestamp: new Date().toISOString(),
    userAgent: 'TelegramBot',
    session
  });

  return jsonResp({ success: true, token, session, isSubscribed: true });
}

// ═══ Validate one-time token ═══
function handleValidateToken(token) {
  if (!token) return jsonResp({ success: false });

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][6] === token || data[i][7] === token) {
      return jsonResp({ success: true, session: data[i][7] || token });
    }
  }

  return jsonResp({ success: false, message: 'Invalid token' });
}

// ═══ Check existing session ═══
function handleCheckSession(session) {
  if (!session) return jsonResp({ success: false });

  if (session.startsWith('local_')) {
    return jsonResp({ success: true });
  }

  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][7] === session) {
      return jsonResp({ success: true });
    }
  }

  return jsonResp({ success: false, message: 'Session not found' });
}

// ═══ Check Telegram channel subscription ═══
function checkSubscription(telegramId) {
  try {
    const url = 'https://api.telegram.org/bot' + CONFIG.BOT_TOKEN + '/getChatMember';
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: CONFIG.CHANNEL_ID, user_id: telegramId }),
      muteHttpExceptions: true
    });

    const result = JSON.parse(resp.getContentText());
    if (result.ok) {
      return ['creator', 'administrator', 'member'].includes(result.result.status);
    }
    return false;
  } catch (err) {
    Logger.log('Subscription check error: ' + err);
    return false;
  }
}

// ═══ Save lead to Google Sheets ═══
function saveLead(lead) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();

  let existingRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === lead.telegram) {
      existingRow = i + 1;
      break;
    }
  }

  const row = [
    lead.timestamp,
    lead.name,
    lead.telegram,
    lead.method,
    lead.source,
    lead.userAgent,
    '', // token placeholder
    lead.session
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

// ═══ Get or create sheet ═══
function getSheet() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    sheet.appendRow([
      'Timestamp', 'Name', 'Telegram', 'Method', 'Source', 'User Agent', 'Token', 'Session'
    ]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 8).setFontWeight('bold');
  }

  return sheet;
}

// ═══ Helpers ═══
function generateToken(telegramId) {
  const ts = new Date().getTime();
  const hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    telegramId + ':' + ts + ':' + CONFIG.SECRET
  );
  return Utilities.base64Encode(hash).substring(0, 32);
}

function generateSession(identifier) {
  const ts = new Date().getTime();
  const hash = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    'session:' + identifier + ':' + ts + ':' + CONFIG.SECRET
  );
  return 's_' + Utilities.base64Encode(hash).substring(0, 40);
}

function jsonResp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══ Test functions ═══
function testCheckSubscription() {
  const result = checkSubscription(123456789);
  Logger.log('Subscription: ' + result);
}

function testGetSheet() {
  const sheet = getSheet();
  Logger.log('Sheet: ' + sheet.getName() + ', rows: ' + sheet.getLastRow());
}
