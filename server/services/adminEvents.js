const tenantClients = new Map();

function sseHandler(req, res) {
  const tenantId = req.tenantId;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(':ok\n\n');

  if (!tenantClients.has(tenantId)) {
    tenantClients.set(tenantId, new Set());
  }
  tenantClients.get(tenantId).add(res);

  const heartbeat = setInterval(() => {
    res.write(':ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const set = tenantClients.get(tenantId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) {
      tenantClients.delete(tenantId);
    }
  });
}

function broadcast(eventName, data, tenantId) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data || {})}\n\n`;

  if (tenantId !== undefined) {
    const set = tenantClients.get(tenantId);
    if (set) {
      set.forEach((res) => res.write(payload));
    }
    return;
  }

  for (const set of tenantClients.values()) {
    set.forEach((res) => res.write(payload));
  }
}

module.exports = { sseHandler, broadcast };
