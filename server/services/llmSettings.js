const { query } = require('../db');

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

  return {
    global_open_question_context: String(parsed.global_open_question_context || '').trim(),
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
    global_open_question_context: String(patch.global_open_question_context || '').trim(),
  };

  await query(
    'UPDATE tenants SET llm_config = ? WHERE id = ?',
    [JSON.stringify(next), tenantId]
  );

  return normalizeLlmSettings(next);
}

module.exports = {
  normalizeLlmSettings,
  getLlmSettings,
  updateLlmSettings,
};
