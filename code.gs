/***************************************************
 * code.gs
 * Webhook Telegram + router de comandos (MVP estable)
 * - 200 OK sin redirecciones (HtmlService) → evita 302
 * - Dedupe por update_id (Cache 30s)
 * - Anti-old updates (>2 min)
 * - Modo pausa
 * - Utilidades de propiedades/webhook/diagnóstico
 ***************************************************/

/** ========== Modo pausa / salud del bot ========== **/

function isPaused_() {
  return PropertiesService.getScriptProperties().getProperty('BOT_PAUSED') === 'true';
}

// 200 OK sin redirecciones (evita 302)
function ok_() { 
  return HtmlService.createHtmlOutput('OK'); 
}

function BOT_pause() { 
  PropertiesService.getScriptProperties().setProperty('BOT_PAUSED','true'); 
}
function BOT_resume() { 
  PropertiesService.getScriptProperties().deleteProperty('BOT_PAUSED'); 
}
function BOT_status() {
  const paused = isPaused_();
  Logger.log({ paused });
  return paused ? '⏸️ Bot PAUSADO' : '▶️ Bot ACTIVO';
}

/** ========== Envío de mensajes a Telegram ========== **/

function sendTelegramMessage_(chatId, text, extra) {
  if (isPaused_()) return; // no enviar si pausado
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en Propiedades del Script.');

  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const payload = Object.assign({
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',             // tienes help() en HTML
    disable_web_page_preview: true
  }, (extra || {}));

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    Logger.log('sendMessage ERROR ' + code + ' → ' + res.getContentText());
  }
}

/** ========== Utils generales ========== **/

// partir por | y limpiar
function splitArgsPipe_(line) {
  if (!line) return [];
  return line
    .split('|')
    .map(function (s){ return s.trim(); })
    .filter(function (s){ return s.length || s === '0'; });
}

// salida GET para probar que /exec vive (en incógnito debe responder "OK")
function doGet() { 
  return ok_(); 
}

/** ========== doPost: router principal ========== **/

function doPost(e) {
  try {
    if (isPaused_()) return ok_(); // cortafuegos

    // Blindaje: si no viene nada o ejec. manual → 200 y salimos
    if (!e || !e.postData || !e.postData.contents) return ok_();

    // 1) Parseo básico del update
    const update = JSON.parse(e.postData.contents || '{}');
    const updId = update.update_id;
    const msg = update.message || update.edited_message;
    if (!msg) return ok_();

    const chatId = msg.chat && msg.chat.id;
    const rawText = (msg.text || '').trim();
    if (!rawText) return ok_();

    // 2) Anti-loop: ignora updates antiguos (> 2 min)
    const isOld = ((Date.now()/1000) - (msg.date || 0)) > 120;
    if (isOld) return ok_();

    // 3) Deduplicación por update_id (Cache 30s)
    if (updId != null) {
      const cache = CacheService.getScriptCache();
      const seen = cache.get('upd:' + updId);
      if (seen) return ok_();
      cache.put('upd:' + updId, '1', 30);
    }

    // 4) Normalización (soporta /cmd@Bot y espacios)
    const text = rawText.replace(/\s+/g, ' ');
    // const lower = text.toLowerCase();

    // 5) HELP: acepta /help, help, /ayuda, ayuda, /bot ayuda (+@Bot)
    if (/^(?:\/help(?:@[\w_]+)?|help|\/ayuda(?:@[\w_]+)?|ayuda|\/bot\s+ayuda)$/i.test(text)) {
      // IAHome.helpMessage() debe existir en functions.gs
      sendTelegramMessage_(chatId, IAHome.helpMessage());
      return ok_();
    }

    // 6) COMANDOS MVP (tus funciones ya existen en functions.gs)

    // /water NombrePlanta
    {
      const m = text.match(/^\/water(?:@[\w_]+)?\s+(.+)$/i);
      if (m) {
        const nombre = m[1].trim();
        try {
          const msgOut = IAHome.waterPlantByName(nombre);
          sendTelegramMessage_(chatId, msgOut);
        } catch (err) {
          sendTelegramMessage_(chatId, '⚠️ ' + err.message);
        }
        return ok_();
      }
    }

    // /addplant Nombre|Tipo|Ubicacion|Frecuencia|[Nombre_Comp]|[Fecha]
    {
      const m = text.match(/^\/addplant(?:@[\w_]+)?\s+(.+)$/i);
      if (m) {
        const a = splitArgsPipe_(m[1]);
        if (a.length < 4) {
          sendTelegramMessage_(chatId,
            'Formato: <code>/addplant Nombre|Tipo|Ubicacion|Frecuencia|[Nombre_Comp]|[Fecha]</code>');
          return ok_();
        }
        const [nombre, tipo, ubic, freq, nombreComp, fecha] = a;
        try {
          const msgOut = IAHome.addPlant(nombre, tipo, ubic, freq, nombreComp, fecha);
          sendTelegramMessage_(chatId, msgOut);
        } catch (err) {
          sendTelegramMessage_(chatId, '⚠️ ' + err.message);
        }
        return ok_();
      }
    }

    // /addrecipe Nombre|Categoria|TiempoMin|Raciones|[Dificultad]
    {
      const m = text.match(/^\/addrecipe(?:@[\w_]+)?\s+(.+)$/i);
      if (m) {
        const a = splitArgsPipe_(m[1]);
        if (a.length < 4) {
          sendTelegramMessage_(chatId,
            'Formato: <code>/addrecipe Nombre|Categoria|TiempoMin|Raciones|[Dificultad]</code>');
          return ok_();
        }
        const [nombre, cat, tmin, raciones, dif] = a;
        try {
          const msgOut = IAHome.addRecipeLight(nombre, cat, Number(tmin), Number(raciones), dif);
          sendTelegramMessage_(chatId, msgOut);
        } catch (err) {
          sendTelegramMessage_(chatId, '⚠️ ' + err.message);
        }
        return ok_();
      }
    }

    // /buy Nombre|Cantidad|Unidad|[Prioridad]
    {
      const m = text.match(/^\/buy(?:@[\w_]+)?\s+(.+)$/i);
      if (m) {
        const a = splitArgsPipe_(m[1]);
        if (a.length < 3) {
          sendTelegramMessage_(chatId,
            'Formato: <code>/buy Nombre|Cantidad|Unidad|[Prioridad]</code>');
          return ok_();
        }
        const [nombre, cant, unidad, prioridad] = a;
        try {
          const msgOut = IAHome.addShoppingItem(nombre, Number(cant), unidad, prioridad);
          sendTelegramMessage_(chatId, msgOut);
        } catch (err) {
          sendTelegramMessage_(chatId, '⚠️ ' + err.message);
        }
        return ok_();
      }
    }

    // 7) Fallback (modo comandos, sin NLU aún)
    sendTelegramMessage_(
      chatId,
      '👋 Estoy en modo comandos. Escribe <b>/help</b> o <b>ayuda</b> para ver cómo hablarme.\n' +
      'En la siguiente fase entenderé frases en lenguaje natural.'
    );
    return ok_();

  } catch (err) {
    Logger.log('doPost error: ' + (err.stack || err));
    try {
      const update = JSON.parse(e && e.postData && e.postData.contents || '{}');
      const chatId = (update && update.message && update.message.chat && update.message.chat.id)
        || (update && update.edited_message && update.edited_message.chat && update.edited_message.chat.id);
      if (chatId) sendTelegramMessage_(chatId, '⚠️ Ocurrió un error. Usa <b>/help</b> para ver los comandos.');
    } catch (_) {}
    // Siempre OK para que Telegram no reintente
    return ok_();
  }
}

/** ========== Propiedades (token, chat, hoja) ========== **/

/**
 * Guarda propiedades en Script Properties.
 * Ya tienes el token guardado, pero te dejo la función por si acaso.
 * (Después de usarla, borra los literales sensibles del código).
 */
function setProps() {
  // PropertiesService.getScriptProperties().setProperty('TELEGRAM_TOKEN', 'PEGAR_AQUI_TU_TOKEN');
  // PropertiesService.getScriptProperties().setProperty('ALLOWED_CHAT_ID', '-1001234567890'); // opcional
  // PropertiesService.getScriptProperties().setProperty('DB_SHEET_ID', 'PEGAR_AQUI_ID_SPREADSHEET'); // opcional
  Logger.log('✅ Script properties guardadas (revisa con printProps_).');
}

function printProps_() {
  const p = PropertiesService.getScriptProperties();
  Logger.log({
    has_TELEGRAM_TOKEN: !!p.getProperty('TELEGRAM_TOKEN'),
    ALLOWED_CHAT_ID: p.getProperty('ALLOWED_CHAT_ID') || '(no set)',
    DB_SHEET_ID: p.getProperty('DB_SHEET_ID') || '(no set)',
    BOT_PAUSED: p.getProperty('BOT_PAUSED') || '(no)'
  });
}

/** ========== Webhook (poner / quitar / ver) ========== **/

function setWebhook_() {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('Falta TELEGRAM_TOKEN. Ejecuta setProps().');

  // ⚠️ PEGA AQUÍ tu URL /exec del Web App vigente (tras Deploy/Manage/Deploy)
  const webAppUrl = 'PEGAR_AQUI_TU_WEB_APP_URL';

  const url = 'https://api.telegram.org/bot' + token +
              '/setWebhook?url=' + encodeURIComponent(webAppUrl) +
              '&drop_pending_updates=true';
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log(res.getContentText());
}

function deleteWebhook_() {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/deleteWebhook');
  Logger.log(res.getContentText());
}

function getWebhookInfo_() {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getWebhookInfo');
  Logger.log(res.getContentText());
}

/** ========== Diagnóstico rápido ========== **/

function checkToken_getMe_() {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  const res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe');
  Logger.log(res.getContentText());
}

function sendTestMessage_() {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  const chatId = PropertiesService.getScriptProperties().getProperty('ALLOWED_CHAT_ID');
  if (!token) throw new Error('Falta TELEGRAM_TOKEN.');
  if (!chatId) throw new Error('Pon ALLOWED_CHAT_ID para test.');
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: chatId, text: 'Prueba directa desde GAS ✅' }),
    muteHttpExceptions: true
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
}

/** ========== Triggers (listar / limpiar si algo spamea) ========== **/

function listTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t =>
    Logger.log(t.getHandlerFunction() + ' — ' + t.getEventType()));
}

function deleteAllTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('🧹 Eliminados todos los triggers del proyecto.');
}

/** ========== Simulador de doPost (sin Telegram) ========== **/

function simulateDoPost_() {
  const fake = {
    postData: {
      contents: JSON.stringify({
        update_id: Date.now(),
        message: {
          date: Math.floor(Date.now()/1000),
          chat: { id: 123456789 },
          text: '/help',
          from: { first_name: 'Test', is_bot: false }
        }
      })
    }
  };
  const out = doPost(fake);
  Logger.log('simulateDoPost_ → ' + out.getContent());}


function diagSheets_() {
  const keys = [
    'PLANTAS','RECETAS','INGREDIENTES_RECETA',
    'PASOS_RECETA','INVENTARIO','LISTA_COMPRA',
    'TAREAS','DEFAULT_TIME'
  ];
  keys.forEach(k => {
    try {
      const v = Headers.verifyHeaders(k);
      Logger.log(k + ' → ok=' + v.ok + 
        ' | missing=[' + v.missing.join(', ') + ']' +
        ' | extra=[' + v.extra.join(', ') + ']' +
        ' | found=[' + v.found.join(' | ') + ']');
    } catch (e) {
      Logger.log(k + ' → ERROR: ' + e.message);
    }
  });
}
function runTestSpreadsheetConnection() {
  testSpreadsheetConnection_(); // esta está en aux.gs
}
