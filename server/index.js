require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initializeDatabase, query } = require('./db');
const authMiddleware = require('./middleware/auth');
const { tenantMiddleware } = require('./middleware/tenant');
const { sseHandler } = require('./services/adminEvents');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware global ---
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.set('trust proxy', 1);

// --- Health check ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'business-os',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/admin/events', authMiddleware, sseHandler);
app.get('/api/admin/cleanup-tags', authMiddleware, tenantMiddleware, async (req, res) => {
  try {
    const stateCategories = ['quality', 'sentiment'];
    let deleted = 0;

    for (const category of stateCategories) {
      const result = await query(
        `DELETE t1 FROM tags t1
         INNER JOIN tags t2
         WHERE t1.tenant_id = t2.tenant_id
           AND t1.target_type = t2.target_type
           AND t1.target_id = t2.target_id
           AND t1.category = t2.category
           AND t1.category = ?
           AND t1.id < t2.id
           AND t1.tenant_id = ?`,
        [category, req.tenantId]
      );
      deleted += result.affectedRows || 0;
    }

    const behaviorResult = await query(
      `DELETE t1 FROM tags t1
       INNER JOIN tags t2
       WHERE t1.tenant_id = t2.tenant_id
         AND t1.target_type = t2.target_type
         AND t1.target_id = t2.target_id
         AND t1.category = t2.category
         AND t1.value = t2.value
         AND t1.category = 'intent'
         AND t1.id < t2.id
         AND t1.tenant_id = ?`,
      [req.tenantId]
    );
    deleted += behaviorResult.affectedRows || 0;

    const messageResult = await query(
      "DELETE FROM tags WHERE target_type = 'message' AND tenant_id = ?",
      [req.tenantId]
    );
    deleted += messageResult.affectedRows || 0;

    res.json({ message: `Limpieza completada. ${deleted} tags eliminados.` });
  } catch (err) {
    console.error('[cleanup-tags]', err);
    res.status(500).json({ error: 'Error limpiando tags' });
  }
});

// --- Rutas API ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/contacts', authMiddleware, tenantMiddleware, require('./routes/contacts'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/workshops', require('./routes/workshops'));
app.use('/api/enrollments', require('./routes/enrollments'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/funnel', require('./routes/funnel'));
app.use('/api/finance', require('./routes/finance'));
app.use('/api/marketing', require('./routes/marketing'));
app.use('/api/team', require('./routes/team'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/agenda', require('./routes/agenda'));
// app.use('/api/playbooks', require('./routes/playbooks'));
// app.use('/api/commands', require('./routes/commands'));
// app.use('/api/settings', require('./routes/settings'));

// --- Static files (client/dist) ---
const distPath = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use('/assets', express.static(path.join(distPath, 'assets'), {
    maxAge: 0,
    etag: false,
  }));

  // SPA fallback — readFileSync para evitar cache de Express
  const indexHtml = fs.readFileSync(path.join(distPath, 'index.html'), 'utf-8');
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(indexHtml);
  });
}

// --- Startup ---
async function start() {
  try {
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`[Business OS] Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('[FATAL] Failed to start:', err);
    process.exit(1);
  }
}

start();
