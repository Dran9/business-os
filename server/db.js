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

const INITIAL_FLOW_NODES = [
  {
    node_key: 'nodo_01',
    name: 'Bienvenida',
    type: 'message',
    message_text: 'Hola, soy el asistente de Daniel MacLean. Él trabaja con grupos pequeños y cupos muy limitados, así que antes de pasarte los detalles quiero hacerte una pregunta importante:',
    next_node_key: 'nodo_02',
    position: 0,
  },
  {
    node_key: 'nodo_02',
    name: 'Pregunta inicial',
    type: 'open_question_ai',
    message_text: '¿Qué es lo que más te gustaría entender o destrabar en este momento de tu vida?',
    ai_system_prompt: 'Eres el asistente de Daniel MacLean, terapeuta especializado en constelaciones familiares con más de 25 años de experiencia. Tu tono es cálido, directo y sin jerga de coach o marketing. Cuando el lead responde, haz un reflejo empático breve de lo que dijo (1-2 oraciones máximo, sin minimizar ni exagerar) y luego haz UNA sola pregunta de profundización genuina. Nunca prometas resultados. Nunca uses frases como "por supuesto", "absolutamente", "sin duda". Habla como una persona real.',
    next_node_key: 'nodo_03',
    position: 10,
  },
  {
    node_key: 'nodo_03',
    name: '¿Hace terapia?',
    type: 'options',
    message_text: 'Una pregunta importante antes de continuar: ¿estás haciendo algún tipo de terapia o acompañamiento profesional en este momento?',
    options: [
      { label: 'Sí, estoy en terapia', next_node_key: 'nodo_04a' },
      { label: 'No, no hago terapia', next_node_key: 'nodo_04b' },
    ],
    position: 20,
  },
  {
    node_key: 'nodo_04a',
    name: 'Tipo de terapia',
    type: 'open_question_detect',
    message_text: '¿Con qué tipo de profesional trabajas?',
    keywords: ['psiquiatra', 'psiquiatría', 'medicación', 'medicamento', 'TCA', 'esquizofrenia', 'trastorno', 'hospitalización', 'internación', 'depresión severa', 'crisis'],
    keyword_match_next: 'nodo_05_limite',
    keyword_nomatch_next: 'nodo_06_presentacion',
    position: 30,
  },
  {
    node_key: 'nodo_04b',
    name: 'Sin terapia → presentación',
    type: 'message',
    message_text: 'Entendido. El taller puede ser un muy buen punto de partida. Te cuento los detalles:',
    next_node_key: 'nodo_06_presentacion',
    position: 40,
  },
  {
    node_key: 'nodo_05_limite',
    name: 'Límite clínico',
    type: 'message',
    message_text: 'Gracias por contarme eso. Daniel trabaja de manera complementaria a la terapia, no como reemplazo. En tu situación lo más honesto es que primero fortalezcas ese proceso individual. ¿Te gustaría que Daniel te contacte personalmente para orientarte mejor?',
    next_node_key: 'nodo_escalacion',
    position: 50,
  },
  {
    node_key: 'nodo_06_presentacion',
    name: 'Presentación del taller',
    type: 'message',
    message_text: 'El próximo taller es el [FECHA] en [VENUE], de [HORA_INICIO] a [HORA_FIN].\n\nTienes dos formas de vivir la experiencia:\n\n🔹 *Participar* — 150 Bs.\nEres representante y testigo. Ideal si es tu primera vez o quieres conocer el método.\n\n🔸 *Constelar* — 250 Bs.\nTrabajas tu caso propio. Solo 7 cupos disponibles.\n\n¿Cuál resuena más contigo?',
    next_node_key: 'nodo_07_eleccion',
    position: 60,
  },
  {
    node_key: 'nodo_07_eleccion',
    name: 'Elección de modalidad',
    type: 'options',
    message_text: '¿Qué opción eliges?',
    options: [
      { label: 'Participar — 150 Bs', next_node_key: 'nodo_08p_apellido' },
      { label: 'Constelar — 250 Bs', next_node_key: 'nodo_08_verificar_cupos' },
    ],
    position: 70,
  },
  {
    node_key: 'nodo_08_verificar_cupos',
    name: 'Verificar cupos constelar',
    type: 'action',
    action_type: 'check_workshop_capacity',
    next_node_key: 'nodo_09c_apellido',
    position: 80,
  },
  {
    node_key: 'nodo_08p_apellido',
    name: 'Apellido participante',
    type: 'capture_data',
    message_text: '¿Que apellidas? (Solo un apellido)',
    capture_field: 'last_name',
    next_node_key: 'nodo_08p_nombre',
    position: 82,
  },
  {
    node_key: 'nodo_08p_nombre',
    name: 'Nombre participante',
    type: 'capture_data',
    message_text: '¿Qúe nombre tienes? (Solo un nombre si no es compuesto)',
    capture_field: 'first_name',
    next_node_key: 'nodo_08_qr_participante',
    position: 84,
  },
  {
    node_key: 'nodo_09c_apellido',
    name: 'Apellido constelar',
    type: 'capture_data',
    message_text: '¿Que apellidas? (Solo un apellido)',
    capture_field: 'last_name',
    next_node_key: 'nodo_09c_nombre',
    position: 86,
  },
  {
    node_key: 'nodo_09c_nombre',
    name: 'Nombre constelar',
    type: 'capture_data',
    message_text: '¿Qúe nombre tienes? (Solo un nombre si no es compuesto)',
    capture_field: 'first_name',
    next_node_key: 'nodo_09_qr_constelar',
    position: 88,
  },
  {
    node_key: 'nodo_09_sin_cupos',
    name: 'Sin cupos para constelar',
    type: 'message',
    message_text: 'Los cupos para constelar están completos para este taller. Pero aún hay lugar como participante, que también es una experiencia muy poderosa. ¿Quieres reservar tu lugar de esa manera?',
    next_node_key: 'nodo_07_eleccion',
    position: 90,
  },
  {
    node_key: 'nodo_09_qr_constelar',
    name: 'Enviar QR constelar',
    type: 'action',
    action_type: 'send_qr',
    next_node_key: 'nodo_10_espera_pago',
    position: 100,
  },
  {
    node_key: 'nodo_08_qr_participante',
    name: 'Enviar QR participante',
    type: 'action',
    action_type: 'send_qr',
    next_node_key: 'nodo_10_espera_pago',
    position: 110,
  },
  {
    node_key: 'nodo_10_espera_pago',
    name: 'Espera comprobante',
    type: 'open_question_detect',
    message_text: 'Cuando hayas realizado la transferencia, mándame la foto del comprobante y quedo confirmado tu lugar.',
    keywords: ['foto', 'imagen', 'comprobante', 'pago', 'transferencia'],
    keyword_match_next: 'nodo_11_ocr',
    keyword_nomatch_next: 'nodo_10_espera_pago',
    position: 120,
  },
  {
    node_key: 'nodo_11_ocr',
    name: 'Procesar OCR',
    type: 'action',
    action_type: 'process_payment_proof',
    next_node_key: 'nodo_12_confirmacion',
    position: 130,
  },
  {
    node_key: 'nodo_12_confirmacion',
    name: 'Confirmación final',
    type: 'message',
    message_text: '¡Listo! Tu lugar está confirmado. Daniel te contactará próximamente con los detalles finales y cualquier información que necesites antes del taller. Nos vemos pronto 🙏',
    next_node_key: null,
    position: 140,
  },
  {
    node_key: 'nodo_escalacion',
    name: 'Escalar a Daniel',
    type: 'action',
    action_type: 'escalate',
    next_node_key: null,
    position: 150,
  },
];

function stringifyJsonField(value) {
  return value == null ? null : JSON.stringify(value);
}

async function seedInitialFlowNodes(conn, tenantId) {
  const [existing] = await conn.execute(
    'SELECT COUNT(*) AS total FROM flow_nodes WHERE tenant_id = ?',
    [tenantId]
  );

  if (Number(existing?.[0]?.total || 0) > 0) {
    return;
  }

  for (const node of INITIAL_FLOW_NODES) {
    await conn.execute(
      `INSERT INTO flow_nodes (
         tenant_id, node_key, name, type, message_text, ai_system_prompt, keywords,
         options, next_node_key, keyword_match_next, keyword_nomatch_next, capture_field,
         action_type, position, active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        tenantId,
        node.node_key,
        node.name,
        node.type,
        node.message_text || null,
        node.ai_system_prompt || null,
        stringifyJsonField(node.keywords),
        stringifyJsonField(node.options),
        node.next_node_key || null,
        node.keyword_match_next || null,
        node.keyword_nomatch_next || null,
        node.capture_field || null,
        node.action_type || null,
        node.position || 0,
      ]
    );
  }

  console.log(`[DB] Flow inicial sembrado para tenant ${tenantId}`);
}

async function upgradeDefaultEnrollmentCaptureNodes(conn, tenantId) {
  const [existingCapture] = await conn.execute(
    `SELECT id
     FROM flow_nodes
     WHERE tenant_id = ? AND type = 'capture_data'
     LIMIT 1`,
    [tenantId]
  ).catch(() => [[]]);

  if (existingCapture.length > 0) {
    return;
  }

  const keys = [
    'nodo_07_eleccion',
    'nodo_08_verificar_cupos',
    'nodo_08_qr_participante',
    'nodo_09_qr_constelar',
  ];

  const [rows] = await conn.execute(
    `SELECT id, node_key, type, options, next_node_key
     FROM flow_nodes
     WHERE tenant_id = ? AND node_key IN (${keys.map(() => '?').join(', ')})`,
    [tenantId, ...keys]
  );

  const byKey = Object.fromEntries(rows.map((row) => [row.node_key, row]));
  if (
    !byKey.nodo_07_eleccion
    || !byKey.nodo_08_verificar_cupos
    || !byKey.nodo_08_qr_participante
    || !byKey.nodo_09_qr_constelar
  ) {
    return;
  }

  const options = JSON.parse(byKey.nodo_07_eleccion.options || '[]');
  const participantOption = options.find((option) => option?.next_node_key === 'nodo_08_qr_participante');
  const constellationOption = options.find((option) => option?.next_node_key === 'nodo_08_verificar_cupos');
  if (!participantOption || !constellationOption || byKey.nodo_08_verificar_cupos.next_node_key !== 'nodo_09_qr_constelar') {
    return;
  }

  const captureNodes = [
    {
      node_key: 'nodo_08p_apellido',
      name: 'Apellido participante',
      type: 'capture_data',
      message_text: '¿Que apellidas? (Solo un apellido)',
      capture_field: 'last_name',
      next_node_key: 'nodo_08p_nombre',
      position: 82,
    },
    {
      node_key: 'nodo_08p_nombre',
      name: 'Nombre participante',
      type: 'capture_data',
      message_text: '¿Qúe nombre tienes? (Solo un nombre si no es compuesto)',
      capture_field: 'first_name',
      next_node_key: 'nodo_08_qr_participante',
      position: 84,
    },
    {
      node_key: 'nodo_09c_apellido',
      name: 'Apellido constelar',
      type: 'capture_data',
      message_text: '¿Que apellidas? (Solo un apellido)',
      capture_field: 'last_name',
      next_node_key: 'nodo_09c_nombre',
      position: 86,
    },
    {
      node_key: 'nodo_09c_nombre',
      name: 'Nombre constelar',
      type: 'capture_data',
      message_text: '¿Qúe nombre tienes? (Solo un nombre si no es compuesto)',
      capture_field: 'first_name',
      next_node_key: 'nodo_09_qr_constelar',
      position: 88,
    },
  ];

  for (const node of captureNodes) {
    await conn.execute(
      `INSERT INTO flow_nodes (
         tenant_id, node_key, name, type, message_text, capture_field,
         next_node_key, position, active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [
        tenantId,
        node.node_key,
        node.name,
        node.type,
        node.message_text,
        node.capture_field,
        node.next_node_key,
        node.position,
      ]
    ).catch(() => {});
  }

  const nextOptions = options.map((option) => (
    option?.next_node_key === 'nodo_08_qr_participante'
      ? { ...option, next_node_key: 'nodo_08p_apellido' }
      : option
  ));

  await conn.execute(
    'UPDATE flow_nodes SET options = ? WHERE tenant_id = ? AND id = ?',
    [stringifyJsonField(nextOptions), tenantId, byKey.nodo_07_eleccion.id]
  );
  await conn.execute(
    'UPDATE flow_nodes SET next_node_key = ? WHERE tenant_id = ? AND id = ?',
    ['nodo_09c_apellido', tenantId, byKey.nodo_08_verificar_cupos.id]
  );

  console.log(`[DB] Flow default actualizado con captura de identidad para tenant ${tenantId}`);
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
        payment_options JSON,
        payment_destination_accounts TEXT,
        payment_qr_1 MEDIUMBLOB,
        payment_qr_1_mime VARCHAR(100),
        payment_qr_2 MEDIUMBLOB,
        payment_qr_2_mime VARCHAR(100),
        payment_qr_3 MEDIUMBLOB,
        payment_qr_3_mime VARCHAR(100),
        payment_qr_4 MEDIUMBLOB,
        payment_qr_4_mime VARCHAR(100),
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
        display_name VARCHAR(200),
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('owner','admin','viewer') DEFAULT 'admin',
        active BOOLEAN DEFAULT TRUE,
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
        phone VARCHAR(20) NULL,
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

    // --- Contacts ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        phone VARCHAR(30) NOT NULL,
        wa_name VARCHAR(200) DEFAULT NULL,
        clean_name VARCHAR(200) DEFAULT NULL,
        name_quality ENUM('nombre_completo','nombre_parcial','sin_nombre') DEFAULT 'sin_nombre',
        label ENUM('cliente','cliente_agenda','nurture','cold','lista_negra') DEFAULT 'cold',
        city VARCHAR(100) DEFAULT NULL,
        first_contact_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_contact_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        needs_review BOOLEAN DEFAULT FALSE,
        review_reason VARCHAR(100) DEFAULT NULL,
        notes TEXT DEFAULT NULL,
        deleted_at DATETIME DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_phone_tenant (tenant_id, phone),
        KEY idx_label (tenant_id, label),
        KEY idx_deleted (deleted_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // --- WhatsApp identity map (phone <-> BSUID) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        bsuid VARCHAR(120) DEFAULT NULL,
        parent_bsuid VARCHAR(120) DEFAULT NULL,
        phone VARCHAR(20) DEFAULT NULL,
        username VARCHAR(120) DEFAULT NULL,
        client_id INT DEFAULT NULL,
        source_waba_id VARCHAR(100) DEFAULT NULL,
        source_phone_number_id VARCHAR(100) DEFAULT NULL,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_whatsapp_users_tenant_bsuid (tenant_id, bsuid),
        UNIQUE KEY uk_whatsapp_users_tenant_phone (tenant_id, phone),
        KEY idx_whatsapp_users_client (tenant_id, client_id),
        KEY idx_whatsapp_users_seen (tenant_id, last_seen_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE SET NULL
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

    // --- Flow nodes (Embudo dinámico) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS flow_nodes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        node_key VARCHAR(50) NOT NULL,
        name VARCHAR(100) NOT NULL,
        type ENUM('message', 'open_question_ai', 'open_question_detect', 'options', 'action', 'capture_data') NOT NULL,
        message_text TEXT,
        ai_system_prompt TEXT,
        keywords JSON,
        options JSON,
        next_node_key VARCHAR(50),
        keyword_match_next VARCHAR(50),
        keyword_nomatch_next VARCHAR(50),
        capture_field VARCHAR(50),
        action_type VARCHAR(50),
        position INT DEFAULT 0,
        send_delay_seconds INT DEFAULT 0,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_node (tenant_id, node_key),
        KEY idx_flow_nodes_tenant_position (tenant_id, position),
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
        bsuid VARCHAR(120) DEFAULT NULL,
        current_phase VARCHAR(50),
        status ENUM('active','converted','lost','escalated','dormant') DEFAULT 'active',
        assigned_to VARCHAR(100) DEFAULT 'bot',
        inbox_state VARCHAR(20) DEFAULT 'open',
        bot_messages_count INT DEFAULT 0,
        human_messages_count INT DEFAULT 0,
        escalation_reason TEXT,
        internal_notes TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_message_at DATETIME,
        converted_at DATETIME,
        escalated_at DATETIME,
        metadata JSON,
        KEY idx_tenant_status (tenant_id, status),
        KEY idx_lead (lead_id),
        KEY idx_bsuid (tenant_id, bsuid),
        KEY idx_workshop (workshop_id),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
        FOREIGN KEY (playbook_id) REFERENCES playbooks(id) ON DELETE SET NULL,
        FOREIGN KEY (workshop_id) REFERENCES workshops(id) ON DELETE SET NULL
      )
    `);

    // --- Flow sessions (tracking del embudo) ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS flow_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        conversation_id INT NOT NULL,
        lead_id INT,
        current_node_key VARCHAR(50) NOT NULL,
        context JSON,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        status ENUM('active', 'completed', 'escalated', 'abandoned') DEFAULT 'active',
        KEY idx_flow_sessions_conversation (conversation_id),
        KEY idx_flow_sessions_status (tenant_id, status),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
      )
    `);

    // --- Messages ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT NOT NULL,
        direction ENUM('inbound','outbound') NOT NULL,
        sender VARCHAR(120) NOT NULL,
        bsuid VARCHAR(120) DEFAULT NULL,
        content_type ENUM('text','image','document','audio','button_reply','template','system') DEFAULT 'text',
        content TEXT,
        wa_message_id VARCHAR(100),
        phase_at_time VARCHAR(50),
        metadata JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        KEY idx_conversation (conversation_id),
        KEY idx_wa_msg (wa_message_id),
        KEY idx_bsuid (bsuid),
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
        participant_role ENUM('constela','participa') DEFAULT 'participa',
        attendance_status ENUM('pending','present','absent') DEFAULT 'pending',
        attendance_marked_at DATETIME,
        attendance_marked_by VARCHAR(100),
        amount_paid DECIMAL(10,2) DEFAULT 0,
        amount_due DECIMAL(10,2),
        payment_status ENUM('unpaid','partial','paid','refunded') DEFAULT 'unpaid',
        payment_method ENUM('unknown','transfer','onsite','manual') DEFAULT 'unknown',
        enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confirmed_at DATETIME,
        cancelled_at DATETIME,
        payment_requested_at DATETIME,
        verified_at DATETIME,
        payment_recorded_at DATETIME,
        payment_recorded_by VARCHAR(100),
        payment_proof MEDIUMBLOB,
        payment_proof_type VARCHAR(100),
        ocr_data JSON,
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
        revenue_generated DECIMAL(10,2) DEFAULT 0,
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

    // --- AI context documents ---
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS ai_context_documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(120) NOT NULL,
        extracted_text MEDIUMTEXT NOT NULL,
        char_count INT DEFAULT 0,
        active BOOLEAN DEFAULT TRUE,
        created_by VARCHAR(100),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_ai_context_docs_tenant (tenant_id, active, created_at),
        FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
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
            payment_options: true,
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

    // --- Seed admin user (PIN 4747) ---
    const [admins] = await conn.execute('SELECT id FROM admin_users LIMIT 1');
    if (admins.length === 0) {
      const [t] = await conn.execute('SELECT id FROM tenants LIMIT 1');
      if (t.length > 0) {
        await conn.execute(
          'INSERT INTO admin_users (tenant_id, username, display_name, password_hash, role, active) VALUES (?, ?, ?, ?, ?, TRUE)',
          [t[0].id, 'owner', 'Daniel', '$2a$12$YC/nDqc79w9PcdVTBr8c0.Tp5WzyQiqSLLnZ7btwb4RLmoEBRmCb.', 'owner']
        );
        console.log('[DB] Admin creado con PIN por defecto');
      }
    }

    await conn.execute('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS display_name VARCHAR(200)').catch(() => {});
    await conn.execute('ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE').catch(() => {});
    await conn.execute('ALTER TABLE leads MODIFY COLUMN phone VARCHAR(20) NULL').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_options JSON').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_destination_accounts TEXT').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_qr_1 MEDIUMBLOB').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_qr_1_mime VARCHAR(100)').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_qr_2 MEDIUMBLOB').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_qr_2_mime VARCHAR(100)').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_qr_3 MEDIUMBLOB').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_qr_3_mime VARCHAR(100)').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_qr_4 MEDIUMBLOB').catch(() => {});
    await conn.execute('ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_qr_4_mime VARCHAR(100)').catch(() => {});
    await conn.execute('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS inbox_state VARCHAR(20) DEFAULT "open"').catch(() => {});
    await conn.execute('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS internal_notes TEXT').catch(() => {});
    await conn.execute('ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bsuid VARCHAR(120)').catch(() => {});
    await conn.execute('ALTER TABLE conversations ADD INDEX IF NOT EXISTS idx_bsuid (tenant_id, bsuid)').catch(() => {});
    await conn.execute('UPDATE conversations SET inbox_state = "open" WHERE inbox_state IS NULL OR inbox_state = ""').catch(() => {});
    await conn.execute('ALTER TABLE messages ADD COLUMN IF NOT EXISTS bsuid VARCHAR(120)').catch(() => {});
    await conn.execute('ALTER TABLE messages MODIFY COLUMN sender VARCHAR(120) NOT NULL').catch(() => {});
    await conn.execute('ALTER TABLE messages ADD INDEX IF NOT EXISTS idx_bsuid (bsuid)').catch(() => {});
    await conn.execute('ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS revenue_generated DECIMAL(10,2) DEFAULT 0').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_requested_at DATETIME').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS verified_at DATETIME').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_proof MEDIUMBLOB').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_proof_type VARCHAR(100)').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS ocr_data JSON').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS participant_role ENUM("constela","participa") DEFAULT "participa"').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS attendance_status ENUM("pending","present","absent") DEFAULT "pending"').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS attendance_marked_at DATETIME').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS attendance_marked_by VARCHAR(100)').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_method ENUM("unknown","transfer","onsite","manual") DEFAULT "unknown"').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_recorded_at DATETIME').catch(() => {});
    await conn.execute('ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS payment_recorded_by VARCHAR(100)').catch(() => {});
    await conn.execute(
      "UPDATE enrollments SET participant_role = 'constela' WHERE notes LIKE '%Modalidad: constelar%'"
    ).catch(() => {});
    await conn.execute(
      "UPDATE enrollments SET participant_role = 'participa' WHERE participant_role IS NULL OR participant_role = ''"
    ).catch(() => {});
    await conn.execute(
      "UPDATE enrollments SET payment_method = 'transfer' WHERE payment_method = 'unknown' AND payment_status = 'paid' AND (payment_proof IS NOT NULL OR verified_at IS NOT NULL)"
    ).catch(() => {});
    await conn.execute('ALTER TABLE flow_nodes MODIFY COLUMN type ENUM("message", "open_question_ai", "open_question_detect", "options", "action", "capture_data") NOT NULL').catch(() => {});
    await conn.execute('ALTER TABLE flow_nodes ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE').catch(() => {});
    await conn.execute('ALTER TABLE flow_nodes ADD COLUMN IF NOT EXISTS position INT DEFAULT 0').catch(() => {});
    await conn.execute('ALTER TABLE flow_nodes ADD COLUMN IF NOT EXISTS capture_field VARCHAR(50)').catch(() => {});
    await conn.execute('ALTER TABLE flow_nodes ADD COLUMN IF NOT EXISTS send_delay_seconds INT DEFAULT 0').catch(() => {});
    await conn.execute('ALTER TABLE flow_sessions ADD COLUMN IF NOT EXISTS status ENUM("active", "completed", "escalated", "abandoned") DEFAULT "active"').catch(() => {});
    await conn.execute('ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_id INT DEFAULT NULL').catch(() => {});
    await conn.execute('ALTER TABLE leads ADD INDEX IF NOT EXISTS idx_contact_id (contact_id)').catch(() => {});
    await conn.execute('ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at DATETIME DEFAULT NULL').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS parent_bsuid VARCHAR(120)').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS username VARCHAR(120)').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS client_id INT DEFAULT NULL').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS source_waba_id VARCHAR(100)').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS source_phone_number_id VARCHAR(100)').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS created_at DATETIME DEFAULT CURRENT_TIMESTAMP').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD INDEX IF NOT EXISTS idx_whatsapp_users_client (tenant_id, client_id)').catch(() => {});
    await conn.execute('ALTER TABLE whatsapp_users ADD INDEX IF NOT EXISTS idx_whatsapp_users_seen (tenant_id, last_seen_at)').catch(() => {});
    await conn.execute(
      "UPDATE admin_users SET display_name = 'Daniel' WHERE username = 'owner' AND (display_name IS NULL OR display_name = '')"
    ).catch(() => {});
    await conn.execute('ALTER TABLE leads ADD COLUMN IF NOT EXISTS metadata JSON').catch(() => {});

    await seedInitialFlowNodes(conn, 1);
    await upgradeDefaultEnrollmentCaptureNodes(conn, 1);

    console.log('[DB] Schema inicializado correctamente');
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, queryPaginated, withTransaction, initializeDatabase };
