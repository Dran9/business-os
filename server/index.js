require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initializeDatabase } = require('./db');

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

// --- Rutas API ---
app.use('/api/auth', require('./routes/auth'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/workshops', require('./routes/workshops'));
app.use('/api/conversations', require('./routes/conversations'));
// app.use('/api/playbooks', require('./routes/playbooks'));
// app.use('/api/finance', require('./routes/finance'));
// app.use('/api/campaigns', require('./routes/marketing'));
// app.use('/api/commands', require('./routes/commands'));
// app.use('/api/settings', require('./routes/settings'));
// app.use('/api/agenda', require('./routes/agenda-bridge'));

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
