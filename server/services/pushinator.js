const PUSHINATOR_API_URL = 'https://api.pushinator.com/api/v2/notifications/send';

function pickPushConfig(rawConfig = {}) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

  const apiToken = process.env.PUSHINATOR_API_TOKEN
    || config.api_token
    || config.apiToken
    || config.token
    || null;

  const channelId = process.env.PUSHINATOR_CHANNEL_ID
    || config.channel_id
    || config.channelId
    || null;

  return { apiToken, channelId };
}

async function sendPushinatorNotification(rawConfig, content, options = {}) {
  const { apiToken, channelId } = pickPushConfig(rawConfig);
  if (!apiToken || !channelId || !content) {
    return { skipped: true, reason: 'missing-config' };
  }

  const response = await fetch(PUSHINATOR_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel_id: channelId,
      content,
      acknowledgment_required: options.acknowledgment_required === true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(payload?.message || `Pushinator error ${response.status}`);
    err.details = payload;
    throw err;
  }

  return payload;
}

module.exports = {
  sendPushinatorNotification,
};
