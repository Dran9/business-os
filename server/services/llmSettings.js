const { query } = require('../db');

const DEFAULT_TEXT_BUFFER_IDLE_MS = 4000;
const DEFAULT_TEXT_BUFFER_MAX_MESSAGES = 5;
const DEFAULT_TEXT_BUFFER_MAX_WINDOW_MS = 12000;
const DEFAULT_PRACTICAL_INFO_TEMPLATE = [
  'Hola [NOMBRE].',
  '',
  'Te paso los datos prácticos de [TALLER]:',
  'Fecha: [FECHA]',
  'Horario: [HORA_INICIO] a [HORA_FIN]',
  'Lugar: [VENUE]',
  'Dirección: [VENUE_DIRECCION]',
  'Modalidad: [MODALIDAD]',
  'Inversión: [MONTO]',
  '',
  'Si te surge alguna duda, escríbeme por aquí.',
].join('\n');

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function normalizeTextBufferSettings(source = {}) {
  return {
    text_buffer_idle_ms: clampNumber(source.text_buffer_idle_ms, DEFAULT_TEXT_BUFFER_IDLE_MS, 500, 30000),
    text_buffer_max_messages: clampNumber(source.text_buffer_max_messages, DEFAULT_TEXT_BUFFER_MAX_MESSAGES, 1, 20),
    text_buffer_max_window_ms: clampNumber(source.text_buffer_max_window_ms, DEFAULT_TEXT_BUFFER_MAX_WINDOW_MS, 1000, 90000),
  };
}

function normalizeLlmSettings(rawValue) {
  let parsed = rawValue;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = {};
    }
  }

  parsed = parsed && typeof parsed === 'object' ? parsed : {};
  const textBuffer = normalizeTextBufferSettings(parsed);

  return {
    global_open_question_context: String(parsed.global_open_question_context || '').trim(),
    practical_info_template: String(parsed.practical_info_template || DEFAULT_PRACTICAL_INFO_TEMPLATE).trim(),
    ...textBuffer,
  };
}

async function getLlmSettings(tenantId) {
  const rows = await query(
    'SELECT llm_config FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );

  return normalizeLlmSettings(rows[0]?.llm_config);
}

async function updateLlmSettings(tenantId, patch = {}) {
  const rows = await query(
    'SELECT llm_config FROM tenants WHERE id = ? LIMIT 1',
    [tenantId]
  );

  let current = rows[0]?.llm_config;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current);
    } catch {
      current = {};
    }
  }

  current = current && typeof current === 'object' ? current : {};
  const next = {
    ...current,
  };

  if (Object.prototype.hasOwnProperty.call(patch, 'global_open_question_context')) {
    next.global_open_question_context = String(patch.global_open_question_context || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'practical_info_template')) {
    next.practical_info_template = String(patch.practical_info_template || DEFAULT_PRACTICAL_INFO_TEMPLATE).trim();
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, 'text_buffer_idle_ms')
    || Object.prototype.hasOwnProperty.call(patch, 'text_buffer_max_messages')
    || Object.prototype.hasOwnProperty.call(patch, 'text_buffer_max_window_ms')
  ) {
    Object.assign(next, normalizeTextBufferSettings({
      ...current,
      ...patch,
    }));
  }

  await query(
    'UPDATE tenants SET llm_config = ? WHERE id = ?',
    [JSON.stringify(next), tenantId]
  );

  return normalizeLlmSettings(next);
}

module.exports = {
  DEFAULT_PRACTICAL_INFO_TEMPLATE,
  DEFAULT_TEXT_BUFFER_IDLE_MS,
  DEFAULT_TEXT_BUFFER_MAX_MESSAGES,
  DEFAULT_TEXT_BUFFER_MAX_WINDOW_MS,
  normalizeLlmSettings,
  normalizeTextBufferSettings,
  getLlmSettings,
  updateLlmSettings,
};
