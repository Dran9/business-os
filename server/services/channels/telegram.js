const ChannelAdapter = require('./base');

class TelegramAdapter extends ChannelAdapter {
  constructor(token) {
    super();
    this.token = token;
    this.apiBase = `https://api.telegram.org/bot${token}`;
  }

  get channelName() {
    return 'telegram';
  }

  parseIncoming(body) {
    // Telegram sends updates with message, callback_query, etc.
    const msg = body.message || body.edited_message;
    const callback = body.callback_query;

    if (callback) {
      return {
        senderId: String(callback.from.id),
        senderName: [callback.from.first_name, callback.from.last_name].filter(Boolean).join(' '),
        text: callback.data,
        messageId: String(callback.id),
        contentType: 'button_reply',
        raw: body,
      };
    }

    if (!msg) return null;

    let contentType = 'text';
    let text = msg.text || '';

    if (msg.photo) {
      contentType = 'image';
      text = msg.caption || '[imagen]';
    } else if (msg.document) {
      contentType = 'document';
      text = msg.caption || '[documento]';
    } else if (msg.voice || msg.audio) {
      contentType = 'audio';
      text = '[audio]';
    }

    return {
      senderId: String(msg.from.id),
      senderName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
      text,
      messageId: String(msg.message_id),
      contentType,
      raw: body,
    };
  }

  async sendText(recipientId, text) {
    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: recipientId,
        text,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[Telegram sendText error]', data);
      throw new Error(data.description || 'Telegram send failed');
    }
    return { messageId: String(data.result.message_id) };
  }

  async sendButtons(recipientId, text, buttons) {
    // Telegram inline keyboard
    const keyboard = buttons.map(b => ([{
      text: b.label,
      callback_data: b.id,
    }]));

    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: recipientId,
        text,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[Telegram sendButtons error]', data);
      throw new Error(data.description || 'Telegram send failed');
    }
    return { messageId: String(data.result.message_id) };
  }

  async sendImage(recipientId, imageUrl, caption = '') {
    const res = await fetch(`${this.apiBase}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: recipientId,
        photo: imageUrl,
        caption,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[Telegram sendImage error]', data);
      throw new Error(data.description || 'Telegram send failed');
    }
    return { messageId: String(data.result.message_id) };
  }

  // Responder a callback_query (quita el loading del botón)
  async answerCallback(callbackQueryId) {
    await fetch(`${this.apiBase}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  }

  // Configurar webhook
  async setWebhook(url) {
    const res = await fetch(`${this.apiBase}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, allowed_updates: ['message', 'callback_query'] }),
    });
    const data = await res.json();
    console.log('[Telegram setWebhook]', data);
    return data;
  }
}

module.exports = TelegramAdapter;
