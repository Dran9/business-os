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

    const photo = msg.photo?.[msg.photo.length - 1];
    const document = msg.document || null;

    return {
      senderId: String(msg.from.id),
      senderName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
      text,
      messageId: String(msg.message_id),
      contentType,
      mediaFileId: photo?.file_id || document?.file_id || null,
      filename: document?.file_name || `${contentType || 'file'}-${msg.message_id}`,
      mimeType: document?.mime_type || (photo ? 'image/jpeg' : null),
      raw: body,
      channel: this,
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

  async sendImage(recipientId, image, caption = '', mimeType = 'image/png') {
    let res;
    if (Buffer.isBuffer(image)) {
      const formData = new FormData();
      formData.append('chat_id', recipientId);
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
      formData.append('photo', new Blob([image], { type: mimeType }), 'qr.png');
      res = await fetch(`${this.apiBase}/sendPhoto`, {
        method: 'POST',
        body: formData,
      });
    } else {
      res = await fetch(`${this.apiBase}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: recipientId,
          photo: image,
          caption,
          parse_mode: 'HTML',
        }),
      });
    }
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

  async getMedia(fileId, options = {}) {
    const fileInfoRes = await fetch(`${this.apiBase}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const fileInfo = await fileInfoRes.json();
    if (!fileInfo.ok) {
      throw new Error(fileInfo.description || 'No se pudo obtener el archivo de Telegram');
    }

    const filePath = fileInfo.result?.file_path;
    if (!filePath) {
      throw new Error('Telegram no devolvió file_path');
    }

    const downloadRes = await fetch(`https://api.telegram.org/file/bot${this.token}/${filePath}`);
    if (!downloadRes.ok) {
      throw new Error(`No se pudo descargar el archivo (${downloadRes.status})`);
    }

    const arrayBuffer = await downloadRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType: options.mimeType || downloadRes.headers.get('content-type') || 'application/octet-stream',
      filename: options.filename || filePath.split('/').pop() || 'telegram-file',
    };
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
