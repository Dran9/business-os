/**
 * Interfaz base para adaptadores de canal de mensajería.
 * Telegram y WhatsApp implementan estos métodos.
 * El engine del chatbot NUNCA sabe qué canal está usando.
 */
class ChannelAdapter {
  /**
   * Parsea un webhook entrante y devuelve un mensaje normalizado
   * @param {object} body - Raw body del webhook
   * @returns {{ senderId: string, senderName: string, text: string, messageId: string, contentType: string, raw: object } | null}
   */
  parseIncoming(body) {
    throw new Error('parseIncoming() not implemented');
  }

  /**
   * Envía un mensaje de texto
   * @param {string} recipientId - ID del destinatario en el canal
   * @param {string} text - Texto a enviar
   * @returns {Promise<{ messageId: string }>}
   */
  async sendText(recipientId, text) {
    throw new Error('sendText() not implemented');
  }

  /**
   * Envía un mensaje con botones/quick replies
   * @param {string} recipientId
   * @param {string} text
   * @param {Array<{ id: string, label: string }>} buttons
   * @returns {Promise<{ messageId: string }>}
   */
  async sendButtons(recipientId, text, buttons) {
    throw new Error('sendButtons() not implemented');
  }

  /**
   * Envía una imagen
   * @param {string} recipientId
   * @param {Buffer|string} image - Buffer o URL
   * @param {string} caption
   * @returns {Promise<{ messageId: string }>}
   */
  async sendImage(recipientId, image, caption = '') {
    throw new Error('sendImage() not implemented');
  }

  async getMedia(fileId, options = {}) {
    throw new Error('getMedia() not implemented');
  }

  /**
   * Nombre del canal
   * @returns {string}
   */
  get channelName() {
    throw new Error('channelName not implemented');
  }
}

module.exports = ChannelAdapter;
