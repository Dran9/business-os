const { query } = require('../../db');
const { generateInterestedReply } = require('./llm');
const { analyzeAndTagInboundMessage } = require('../analysis/tagger');
const { recalculateLeadScore } = require('../analysis/scorer');

/**
 * Motor de chatbot — agnóstico al canal.
 * Recibe mensajes normalizados, procesa según playbook, responde vía adapter.
 */
class ChatbotEngine {
  constructor(channelAdapter, tenantId) {
    this.channel = channelAdapter;
    this.tenantId = tenantId;
  }

  /**
   * Procesa un mensaje entrante
   * @param {{ senderId, senderName, text, messageId, contentType }} incoming
   */
  async handleMessage(incoming) {
    const { senderId, senderName, text, messageId, contentType } = incoming;

    try {
      // 1. Buscar o crear lead
      const lead = await this.findOrCreateLead(senderId, senderName);

      // 2. Buscar o crear conversación activa
      const conversation = await this.findOrCreateConversation(lead.id);

      // 3. Guardar mensaje entrante
      const inboundMessageId = await this.saveMessage(conversation.id, 'inbound', senderId, text, messageId, contentType);

      // 4. Actualizar timestamps
      await query(
        'UPDATE leads SET last_contact_at = NOW() WHERE id = ?',
        [lead.id]
      );
      await query(
        'UPDATE conversations SET last_message_at = NOW(), human_messages_count = human_messages_count + 1 WHERE id = ?',
        [conversation.id]
      );

      const workshop = conversation.workshop_id
        ? await this.getWorkshopById(conversation.workshop_id)
        : null;

      await analyzeAndTagInboundMessage({
        tenantId: this.tenantId,
        lead,
        conversation,
        workshop,
        messageId: inboundMessageId,
        messageText: text,
      }).catch((err) => {
        console.error('[ChatbotEngine] Tagging skipped by error:', err.message);
      });

      await recalculateLeadScore({
        tenantId: this.tenantId,
        leadId: lead.id,
      }).catch((err) => {
        console.error('[ChatbotEngine] Scoring skipped by error:', err.message);
      });

      // 5. Procesar según fase del playbook
      const response = await this.processPhase(conversation, lead, text, contentType);

      // 6. Enviar respuesta(s)
      if (response) {
        await this.sendResponse(senderId, conversation.id, response);
      }

    } catch (err) {
      console.error('[ChatbotEngine] Error processing message:', err);
      // No crashear — logear y seguir
    }
  }

  async findOrCreateLead(channelId, name) {
    const existing = await query(
      'SELECT * FROM leads WHERE tenant_id = ? AND phone = ?',
      [this.tenantId, channelId]
    );

    if (existing.length > 0) {
      return existing[0];
    }

    // Nuevo lead
    const result = await query(
      `INSERT INTO leads (tenant_id, phone, name, source, status, first_contact_at, last_contact_at)
       VALUES (?, ?, ?, ?, 'new', NOW(), NOW())`,
      [this.tenantId, channelId, name, this.channel.channelName]
    );

    return {
      id: result.insertId,
      phone: channelId,
      name,
      status: 'new',
      quality_score: 0,
    };
  }

  async findOrCreateConversation(leadId) {
    // Buscar conversación activa
    const existing = await query(
      `SELECT * FROM conversations
       WHERE tenant_id = ? AND lead_id = ? AND status IN ('active', 'escalated')
       ORDER BY started_at DESC LIMIT 1`,
      [this.tenantId, leadId]
    );

    if (existing.length > 0) {
      return existing[0];
    }

    // Nueva conversación
    const result = await query(
      `INSERT INTO conversations (tenant_id, lead_id, channel, current_phase, status, started_at, last_message_at)
       VALUES (?, ?, ?, 'welcome', 'active', NOW(), NOW())`,
      [this.tenantId, leadId, this.channel.channelName]
    );

    return {
      id: result.insertId,
      lead_id: leadId,
      current_phase: 'welcome',
      status: 'active',
      playbook_id: null,
    };
  }

  async saveMessage(conversationId, direction, sender, content, messageId, contentType = 'text') {
    const result = await query(
      `INSERT INTO messages (conversation_id, direction, sender, content, wa_message_id, content_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [conversationId, direction, sender, content, messageId, contentType]
    );
    return result.insertId;
  }

  /**
   * Procesa la fase actual y genera respuesta
   * Versión inicial: respuesta de bienvenida inteligente
   * Las fases del playbook se irán agregando
   */
  async processPhase(conversation, lead, text, contentType) {
    const phase = conversation.current_phase;

    // Si la conversación está escalada, no responder automáticamente
    if (conversation.status === 'escalated') {
      return null;
    }

    switch (phase) {
      case 'welcome':
        return this.handleWelcome(conversation, lead, text);

      case 'qualifying':
        return this.handleQualifying(conversation, lead, text);

      case 'interested':
        return this.handleInterested(conversation, lead, text);

      default:
        // Fase no reconocida — respuesta genérica
        return {
          type: 'text',
          text: 'Gracias por tu mensaje. Daniel te responderá pronto.',
        };
    }
  }

  async handleWelcome(conversation, lead, text) {
    const lowerText = text.toLowerCase();

    // Detectar intención básica
    const isTaller = /taller|constelacion|coaching|curso|inscri/i.test(lowerText);
    const isSaludo = /hola|buenas|hey|hi|buen día|buenos días/i.test(lowerText);
    const isPrecio = /precio|costo|cuánto|cuanto|valor/i.test(lowerText);

    // Actualizar fase
    await query(
      'UPDATE conversations SET current_phase = ? WHERE id = ?',
      ['qualifying', conversation.id]
    );

    // Actualizar lead status
    await query(
      'UPDATE leads SET status = "qualifying" WHERE id = ? AND status = "new"',
      [lead.id]
    );

    if (isPrecio) {
      return {
        type: 'buttons',
        text: `Hola ${lead.name || ''}! Gracias por tu interés.\n\n¿Sobre qué taller te gustaría saber el precio?`,
        buttons: await this.getActiveWorkshopButtons(),
      };
    }

    if (isTaller) {
      return {
        type: 'buttons',
        text: `Hola ${lead.name || ''}! Qué bueno que te interesa.\n\n¿Cuál de estos talleres te llama la atención?`,
        buttons: await this.getActiveWorkshopButtons(),
      };
    }

    // Saludo genérico o mensaje sin intent claro
    return {
      type: 'buttons',
      text: `Hola ${lead.name || ''}! Soy el asistente de Daniel MacLean.\n\n¿En qué puedo ayudarte?`,
      buttons: [
        { id: 'talleres', label: 'Ver talleres disponibles' },
        { id: 'info', label: 'Quiero más información' },
        { id: 'hablar', label: 'Hablar con Daniel' },
      ],
    };
  }

  async handleQualifying(conversation, lead, text) {
    const lowerText = text.toLowerCase();

    // Botón: hablar con Daniel → escalar
    if (lowerText === 'hablar' || /hablar|daniel|humano|persona/i.test(lowerText)) {
      await query('UPDATE conversations SET status = "escalated", escalated_at = NOW(), escalation_reason = ? WHERE id = ?',
        ['Lead pidió hablar con Daniel', conversation.id]);
      await query('UPDATE leads SET status = "negotiating" WHERE id = ?', [lead.id]);

      // TODO: Pushinator notification a Daniel

      return {
        type: 'text',
        text: 'Perfecto, Daniel te escribirá personalmente lo antes posible.',
      };
    }

    // Botón: talleres o info
    if (lowerText === 'talleres' || lowerText === 'info' || /taller|ver|disponible|info/i.test(lowerText)) {
      const workshops = await this.getActiveWorkshops();

      if (workshops.length === 0) {
        return {
          type: 'text',
          text: 'Por el momento no hay talleres programados, pero te aviso en cuanto haya uno. ¿Te gustaría hablar con Daniel?',
        };
      }

      await query('UPDATE conversations SET current_phase = "interested" WHERE id = ?', [conversation.id]);
      await query('UPDATE leads SET status = "qualified" WHERE id = ?', [lead.id]);

      return {
        type: 'buttons',
        text: this.formatWorkshopList(workshops),
        buttons: workshops.map(w => ({
          id: `workshop_${w.id}`,
          label: w.name,
        })).concat([{ id: 'hablar', label: 'Hablar con Daniel' }]),
      };
    }

    // Si seleccionó un taller específico (callback de botón)
    const workshopMatch = text.match(/^workshop_(\d+)$/);
    if (workshopMatch) {
      return this.handleWorkshopSelection(conversation, lead, parseInt(workshopMatch[1]));
    }

    // Mensaje libre — respuesta genérica
    return {
      type: 'buttons',
      text: 'Gracias por tu mensaje. ¿Qué te gustaría hacer?',
      buttons: [
        { id: 'talleres', label: 'Ver talleres disponibles' },
        { id: 'hablar', label: 'Hablar con Daniel' },
      ],
    };
  }

  async handleInterested(conversation, lead, text) {
    // Si seleccionó un taller
    const workshopMatch = text.match(/^workshop_(\d+)$/);
    if (workshopMatch) {
      return this.handleWorkshopSelection(conversation, lead, parseInt(workshopMatch[1]));
    }

    const enrollMatch = text.match(/^inscribir_(\d+)$/);
    if (enrollMatch) {
      return this.handleEnrollmentIntent(conversation, lead, parseInt(enrollMatch[1]));
    }

    if (/hablar|daniel/i.test(text)) {
      await query('UPDATE conversations SET status = "escalated", escalated_at = NOW() WHERE id = ?', [conversation.id]);
      return { type: 'text', text: 'Daniel te escribirá pronto.' };
    }

    const selectedWorkshop = conversation.workshop_id
      ? await this.getWorkshopById(conversation.workshop_id)
      : null;

    const recentMessages = await this.getRecentMessages(conversation.id);
    const llmReply = selectedWorkshop
      ? await generateInterestedReply({
          lead,
          workshop: selectedWorkshop,
          messageText: text,
          recentMessages,
        }).catch((err) => {
          console.error('[ChatbotEngine] LLM fallback:', err.message);
          return null;
        })
      : null;

    if (llmReply) {
      return {
        type: 'text',
        text: llmReply,
      };
    }

    return {
      type: 'buttons',
      text: '¿Sobre cuál taller te gustaría saber más?',
      buttons: await this.getActiveWorkshopButtons(),
    };
  }

  async handleWorkshopSelection(conversation, lead, workshopId) {
    const workshops = await this.getWorkshopById(workshopId);

    if (!workshops) {
      return { type: 'text', text: 'Ese taller ya no está disponible. ¿Puedo ayudarte con algo más?' };
    }

    const w = workshops;
    const spotsLeft = w.max_participants - w.current_participants;

    // Vincular conversación al taller
    await query('UPDATE conversations SET workshop_id = ?, current_phase = "interested" WHERE id = ?',
      [workshopId, conversation.id]);
    await query('UPDATE leads SET status = "negotiating" WHERE id = ?', [lead.id]);

    let details = `<b>${w.name}</b>\n\n`;
    if (w.description) details += `${w.description}\n\n`;
    if (w.date) {
      const fecha = new Date(w.date).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', weekday: 'long', day: 'numeric', month: 'long' });
      details += `Fecha: ${fecha}\n`;
    }
    if (w.time_start) details += `Hora: ${w.time_start}\n`;
    if (w.venue_name) details += `Lugar: ${w.venue_name}\n`;
    if (w.venue_address) details += `Dirección: ${w.venue_address}\n`;
    details += `\nPrecio: Bs ${w.price}`;
    if (w.early_bird_price && w.early_bird_deadline) {
      const hoy = new Date();
      const deadline = new Date(w.early_bird_deadline);
      if (hoy <= deadline) {
        details += ` (early bird: Bs ${w.early_bird_price})`;
      }
    }
    if (spotsLeft <= 5 && spotsLeft > 0) {
      details += `\n\nQuedan solo ${spotsLeft} lugares.`;
    }

    return {
      type: 'buttons',
      text: details,
      buttons: [
        { id: `inscribir_${workshopId}`, label: 'Quiero inscribirme' },
        { id: 'talleres', label: 'Ver otros talleres' },
        { id: 'hablar', label: 'Hablar con Daniel' },
      ],
    };
  }

  async handleEnrollmentIntent(conversation, lead, workshopId) {
    const workshop = await this.getWorkshopById(workshopId);

    if (!workshop) {
      return { type: 'text', text: 'Ese taller ya no está disponible. Si quieres, Daniel te puede orientar con otra opción.' };
    }

    await query('UPDATE leads SET status = "negotiating" WHERE id = ?', [lead.id]);
    await query(
      `INSERT INTO enrollments (tenant_id, workshop_id, lead_id, status, amount_due, payment_status, notes)
       VALUES (?, ?, ?, 'pending', ?, 'unpaid', ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), amount_due = VALUES(amount_due), payment_status = VALUES(payment_status), notes = VALUES(notes)`,
      [this.tenantId, workshop.id, lead.id, workshop.early_bird_price || workshop.price || 0, 'Interés de inscripción desde chatbot']
    ).catch((err) => {
      console.error('[ChatbotEngine] No se pudo crear enrollment:', err.message);
    });

    return {
      type: 'text',
      text: `Perfecto. Ya registré tu interés para ${workshop.name}. Daniel te compartirá el cobro y los siguientes pasos para confirmar tu inscripción.`,
    };
  }

  // --- Helpers ---

  async getActiveWorkshops() {
    return query(
      `SELECT w.*, v.name as venue_name FROM workshops w
       LEFT JOIN venues v ON v.id = w.venue_id
       WHERE w.tenant_id = ? AND w.status IN ('open', 'planned')
       ORDER BY w.date ASC`,
      [this.tenantId]
    );
  }

  async getWorkshopById(workshopId) {
    const workshops = await query(
      `SELECT w.*, v.name as venue_name, v.address as venue_address
       FROM workshops w LEFT JOIN venues v ON v.id = w.venue_id
       WHERE w.id = ? AND w.tenant_id = ?`,
      [workshopId, this.tenantId]
    );
    return workshops[0] || null;
  }

  async getRecentMessages(conversationId) {
    const rows = await query(
      `SELECT direction, content
       FROM messages
       WHERE conversation_id = ?
       ORDER BY id DESC
       LIMIT 6`,
      [conversationId]
    );
    return rows.reverse();
  }

  async getActiveWorkshopButtons() {
    const workshops = await this.getActiveWorkshops();
    if (workshops.length === 0) {
      return [{ id: 'hablar', label: 'Hablar con Daniel' }];
    }
    return workshops.map(w => ({
      id: `workshop_${w.id}`,
      label: w.name,
    })).concat([{ id: 'hablar', label: 'Hablar con Daniel' }]);
  }

  formatWorkshopList(workshops) {
    let text = 'Estos son los talleres disponibles:\n\n';
    for (const w of workshops) {
      text += `• <b>${w.name}</b>`;
      if (w.date) {
        const fecha = new Date(w.date).toLocaleDateString('es-BO', { timeZone: 'America/La_Paz', day: 'numeric', month: 'short' });
        text += ` — ${fecha}`;
      }
      if (w.price) text += ` — Bs ${w.price}`;
      text += '\n';
    }
    text += '\nElige uno para ver más detalles:';
    return text;
  }

  async sendResponse(recipientId, conversationId, response) {
    let sentMessageId;

    switch (response.type) {
      case 'text':
        const r1 = await this.channel.sendText(recipientId, response.text);
        sentMessageId = r1.messageId;
        break;

      case 'buttons':
        const r2 = await this.channel.sendButtons(recipientId, response.text, response.buttons);
        sentMessageId = r2.messageId;
        break;

      case 'image':
        const r3 = await this.channel.sendImage(recipientId, response.image, response.caption);
        sentMessageId = r3.messageId;
        break;
    }

    // Guardar mensaje saliente
    const savedContent = response.text || response.caption || '';
    await this.saveMessage(conversationId, 'outbound', 'bot', savedContent, sentMessageId || '', response.type || 'text');
    await query(
      'UPDATE conversations SET bot_messages_count = bot_messages_count + 1 WHERE id = ?',
      [conversationId]
    );
  }
}

module.exports = ChatbotEngine;
