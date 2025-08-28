/***************************************************
 * code.gs
 * Webhook Telegram + router de comandos
 ***************************************************/

/** --- Killswitch/Pausa sin tocar despliegue --- */
function isPaused_() {
  return PropertiesService.getScriptProperties().getProperty('BOT_PAUSED') === 'true';
}
function ok_() { return ContentService.createTextOutput('OK'); }
function BOT_pause() { PropertiesService.getScriptProperties().setProperty('BOT_PAUSED','true'); }
function BOT_resume() { PropertiesService.getScriptProperties().deleteProperty('BOT_PAUSED'); }

/** --- Envío de mensajes (usa tu propio helper si ya tienes uno) --- */
function sendTelegramMessage_(chatId, text, extra) {
  if (isPaused_()) return; // no enviar si pausado
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('Falta TELEGRAM_TOKEN en Propiedades del Script.');
  const url = 'https://api.telegram.org/bot' + token + '/sendMessage';
  const payload = Object.assign({
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  }, (extra || {}));
  UrlFetchApp.fetch(url, { method:'post', payload, muteHttpExceptions:true });
}

/** --- Util: partir por | y limpiar --- */
function splitArgsPipe_(line) {
  if (!line) return [];
  return line.split('|').map(s => s.trim()).filter(s => s.length || s === '0');
}

/** --- doPost: Router principal --- */
function doPost(e) {
  try {
    if (isPaused_()) return ok_(); // cortafuegos

    // 1) Parseo básico
    const update = JSON.parse(e.postData.contents || '{}');
    const updId = update.update_id;
    const msg = update.message || update.edited_message;
    if (!msg) return ok_();

    const chatId = msg.chat && msg.chat.id;
    const rawText = (msg.text || '').trim();
    if (!rawText) return ok_();

    // 2) Anti-loop: ignora updates antiguos (>2 min)
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
    const lower = text.toLowerCase();

    // 5) HELP: acepta /help, help, /ayuda, ayuda, /bot ayuda (+@Bot)
    if (/^(?:\/help(?:@[\w_]+)?|help|\/ayuda(?:@[\w_]+)?|ayuda|\/bot\s+ayuda)$/i.test(text)) {
      sendTelegramMessage_(chatId, IAHome.helpMessage());
      return ok_();
    }

    // 6) Rutas de comandos (MVP)
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

    // 7) Fallback (texto libre): por ahora, mensaje estable (no GPT aún)
    sendTelegramMessage_(
      chatId,
      '👋 Estoy en modo comandos. Escribe <b>/help</b> o <b>ayuda</b> para ver cómo hablarme.\n' +
      'En la siguiente fase entenderé frases en lenguaje natural.'
    );
    return ok_();

  } catch (err) {
    Logger.log('doPost error: ' + (err.stack || err));
    try {
      const update = JSON.parse(e.postData.contents || '{}');
      const chatId = update?.message?.chat?.id || update?.edited_message?.chat?.id;
      if (chatId) sendTelegramMessage_(chatId, '⚠️ Ocurrió un error. Usa <b>/help</b> para ver los comandos.');
    } catch (_) {}
    return ok_(); // Siempre OK para que Telegram no reintente
  }
}
