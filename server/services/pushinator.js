const PUSHINATOR_API_URL = 'https://api.pushinator.com/api/v2/notifications/send';

function pickPushConfig(rawConfig = {}) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  return {
    apiToken: process.env.PUSHINATOR_TOKEN || config.api_token || null,
    channelId: process.env.PUSHINATOR_CHANNEL_ID || config.channel_id || null,
  };
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
