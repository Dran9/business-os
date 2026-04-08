require('dns').setDefaultResultOrder('ipv4first');
const mysql = require('mysql2/promise');

// --- Pool optimizado para Hostinger ---
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: parseInt(process.env.DB_PORT || '3306'),
  // Timezone Bolivia — NUNCA quitar
  timezone: '-04:00',
  // Pool tuning para Hostinger shared hosting
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 5,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
  // Prepared statements para performance
  namedPlaceholders: true,
});

// --- Transaction helper ---
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// --- Query helper con logging en dev ---
async function query(sql, params = []) {
  const start = Date.now();
  const [rows] = await pool.execute(sql, params);
  const ms = Date.now() - start;
  if (ms > 200) {
    console.warn(`[SLOW QUERY ${ms}ms]`, sql.substring(0, 80));
  }
  return rows;
}

// --- Paginated query helper ---
async function queryPaginated(sql, params = [], { page = 1, limit = 50 } = {}) {
  const offset = (page - 1) * limit;
  const countSql = `SELECT COUNT(*) as total FROM (${sql}) as _count`;
  const dataSql = `${sql} LIMIT ? OFFSET ?`;

  const [[{ total }]] = await pool.execute(countSql, params);
  const [rows] = await pool.execute(dataSql, [...params, String(limit), String(offset)]);

  return {
    data: rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

// ============================================
// Schema — Multi-tenant desde el día 1
// ============================================
async function initializeDatabase() {
  const conn = await pool.getConnection();
  try {
    // --- Tenants ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS tenants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        slug VARCHAR(50) UNIQUE,
        owner_name VARCHAR(200),
        owner_phone VARCHAR(20),
        timezone VARCHAR(50) DEFAULT 'America/La_Paz',
        currency VARCHAR(5) DEFAULT 'BOB',
        currency_symbol VARCHAR(5) DEFAULT 'Bs',
        logo MEDIUMBLOB,
        brand_config JSON,
        wa_config JSON,
        llm_config JSON,
        google_config JSON,
        meta_config JSON,
        push_config JSON,
        agenda_config JSON,
        features_enabled JSON,
        plan ENUM('free','pro','enterprise') DEFAULT 'pro',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // --- Admin users ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        username VARCHAR(100) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('owner','admin','viewer') DEFAULT 'admin',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY (tenant_id, username),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // --- Venues ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS venues (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        address TEXT,
        city VARCHAR(100),
        capacity INT,
        cost_per_use DECIMAL(10,2),
        contact_phone VARCHAR(20),
        maps_url VARCHAR(500),
        notes TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // --- Workshops (talleres como productos) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS workshops (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        type VARCHAR(50),
        modality ENUM('presencial','online','hibrido') DEFAULT 'presencial',
        status ENUM('draft','planned','open','full','completed','cancelled') DEFAULT 'draft',
        date DATE,
        time_start TIME,
        time_end TIME,
        venue_id INT,
        max_participants INT DEFAULT 25,
        current_participants INT DEFAULT 0,
        price DECIMAL(10,2),
        early_bird_price DECIMAL(10,2),
        early_bird_deadline DATE,
        group_price DECIMAL(10,2),
        group_min INT,
        playbook_id INT,
        description TEXT,
        copy_template TEXT,
        qr_image MEDIUMBLOB,
        total_revenue DECIMAL(10,2) DEFAULT 0,
        total_cost DECIMAL(10,2) DEFAULT 0,
        metadata JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_tenant_status (tenant_id, status),
        KEY idx_date (tenant_id, date),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL
      )
    `);

    // --- Leads / CRM ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS leads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        name VARCHAR(200),
        city VARCHAR(100),
        source VARCHAR(50),
        source_detail VARCHAR(200),
        status ENUM('new','qualifying','qualified','negotiating','converted','lost','dormant') DEFAULT 'new',
        quality_score INT DEFAULT 0,
        lifetime_value DECIMAL(10,2) DEFAULT 0,
        workshops_attended INT DEFAULT 0,
        referred_by_lead_id INT,
        tags JSON,
        notes TEXT,
        metadata JSON,
        agenda_client_id INT,
        first_contact_at DATETIME,
        last_contact_at DATETIME,
        converted_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_tenant_phone (tenant_id, phone),
        KEY idx_status (tenant_id, status),
        KEY idx_source (tenant_id, source),
        KEY idx_score (tenant_id, quality_score),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // --- Playbooks (embudos conversacionales) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS playbooks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        phases JSON NOT NULL,
        variables JSON,
        llm_system_prompt TEXT,
        active BOOLEAN DEFAULT TRUE,
        stats JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // --- Conversations ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        lead_id INT NOT NULL,
        playbook_id INT,
        workshop_id INT,
        channel VARCHAR(20) DEFAULT 'whatsapp',
        current_phase VARCHAR(50),
        status ENUM('active','converted','lost','escalated','dormant') DEFAULT 'active',
        assigned_to VARCHAR(100) DEFAULT 'bot',
        bot_messages_count INT DEFAULT 0,
        human_messages_count INT DEFAULT 0,
        escalation_reason TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_message_at DATETIME,
        converted_at DATETIME,
        escalated_at DATETIME,
        metadata JSON,
        KEY idx_tenant_status (tenant_id, status),
        KEY idx_lead (lead_id),
        KEY idx_workshop (workshop_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
        FOREIGN KEY (playbook_id) REFERENCES playbooks(id) ON DELETE SET NULL,
        FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE SET NULL
      )
    `);

    // --- Messages ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        direction ENUM('inbound','outbound') NOT NULL,
        sender VARCHAR(20) NOT NULL,
        content_type ENUM('text','image','document','audio','button_reply','template','system') DEFAULT 'text',
        content TEXT,
        wa_message_id VARCHAR(100),
        phase_at_time VARCHAR(50),
        metadata JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_conversation (conversation_id),
        KEY idx_wa_msg (wa_message_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    // --- Tags ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        target_type ENUM('conversation','message','lead','workshop') NOT NULL,
        target_id INT NOT NULL,
        category VARCHAR(50) NOT NULL,
        value VARCHAR(100) NOT NULL,
        color VARCHAR(7),
        source ENUM('system','llm','manual') DEFAULT 'system',
        confidence FLOAT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_target (target_type, target_id),
        KEY idx_tenant_cat (tenant_id, category),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // --- Financial transactions ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        type ENUM('income','expense') NOT NULL,
        category VARCHAR(50) NOT NULL,
        subcategory VARCHAR(50),
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'BOB',
        description VARCHAR(500),
        date DATE NOT NULL,
        lead_id INT,
        workshop_id INT,
        payment_proof MEDIUMBLOB,
        payment_proof_type VARCHAR(20),
        verified BOOLEAN DEFAULT FALSE,
        verification_method VARCHAR(20),
        ocr_data JSON,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant_date (tenant_id, date),
        KEY idx_tenant_type (tenant_id, type),
        KEY idx_workshop (workshop_id),
        KEY idx_lead (lead_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
        FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE SET NULL
      )
    `);

    // --- Financial goals ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS financial_goals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        period_type ENUM('monthly','quarterly','yearly') DEFAULT 'monthly',
        period_start DATE NOT NULL,
        target_income DECIMAL(10,2),
        target_workshops INT,
        target_participants INT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant_period (tenant_id, period_start),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      )
    `);

    // --- Workshop enrollments (inscripciones) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        workshop_id INT NOT NULL,
        lead_id INT NOT NULL,
        status ENUM('pending','confirmed','waitlist','cancelled','attended','no_show') DEFAULT 'pending',
        amount_paid DECIMAL(10,2) DEFAULT 0,
        amount_due DECIMAL(10,2),
        payment_status ENUM('unpaid','partial','paid','refunded') DEFAULT 'unpaid',
        enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confirmed_at DATETIME,
        cancelled_at DATETIME,
        notes TEXT,
        UNIQUE KEY uk_workshop_lead (workshop_id, lead_id),
        KEY idx_tenant (tenant_id),
        KEY idx_workshop_status (workshop_id, status),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE CASCADE,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
      )
    `);

    // --- Campaigns (tracking de publicidad) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        workshop_id INT,
        name VARCHAR(200) NOT NULL,
        platform VARCHAR(50),
        status ENUM('draft','active','paused','completed') DEFAULT 'draft',
        budget DECIMAL(10,2),
        spent DECIMAL(10,2) DEFAULT 0,
        leads_generated INT DEFAULT 0,
        conversions INT DEFAULT 0,
        copy_text TEXT,
        image_url TEXT,
        meta_post_id VARCHAR(100),
        started_at DATE,
        ended_at DATE,
        metadata JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant (tenant_id),
        KEY idx_workshop (workshop_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE SET NULL
      )
    `);

    // --- Follow-up sequences ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS followup_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        lead_id INT NOT NULL,
        conversation_id INT,
        trigger_type VARCHAR(50) NOT NULL,
        message_template TEXT NOT NULL,
        scheduled_at DATETIME NOT NULL,
        sent_at DATETIME,
        status ENUM('pending','sent','cancelled','failed') DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_scheduled (tenant_id, status, scheduled_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
      )
    `);

    // --- Activity log (auditoría) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        actor VARCHAR(50) NOT NULL,
        action VARCHAR(100) NOT NULL,
        target_type VARCHAR(50),
        target_id INT,
        details JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_tenant_date (tenant_id, created_at),
        KEY idx_target (target_type, target_id)
      )
    `);

    // --- Seed default tenant (Daniel) ---
    const [tenants] = await conn.execute('SELECT id FROM tenants LIMIT 1');
    if (tenants.length === 0) {
      await conn.execute(`
        INSERT INTO tenants (name, slug, owner_name, owner_phone, brand_config, features_enabled)
        VALUES (
          'Daniel MacLean - Talleres',
          'daniel-maclean',
          'Daniel MacLean',
          '59172034151',
          '${JSON.stringify({
            primary: '#1a1a2e',
            secondary: '#16213e',
            accent: '#0f3460',
            surface: '#ffffff',
            text: '#1a1a2e',
            textMuted: '#6b7280',
            success: '#10b981',
            warning: '#f59e0b',
            danger: '#ef4444',
            info: '#3b82f6',
            radius: '8px',
            fontFamily: 'Inter, system-ui, sans-serif'
          })}',
          '${JSON.stringify({
            chatbot: true,
            finance: true,
            marketing: true,
            insights: true,
            agenda_bridge: true
          })}'
        )
      `);
      console.log('[DB] Tenant por defecto creado: daniel-maclean');
    }

    console.log('[DB] Schema inicializado correctamente');
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, queryPaginated, withTransaction, initializeDatabase };
