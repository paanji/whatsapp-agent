// reminderLog.js
// Tracks every reminder message sent, so you can see history and avoid
// re-sending too soon. Automatically prunes records older than 90 days
// (3 months) every time it's used — no manual cleanup needed.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // required for Neon
});

const RETENTION_DAYS = 90;

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reminder_log (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      customer_name TEXT,
      customer_phone TEXT NOT NULL,
      message_content TEXT NOT NULL,
      status TEXT NOT NULL, -- 'sent' or 'failed'
      error_detail TEXT,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_reminder_log_phone ON reminder_log(customer_phone);
    CREATE INDEX IF NOT EXISTS idx_reminder_log_sent_at ON reminder_log(sent_at);
  `);
}

async function pruneOldRecords() {
  const result = await pool.query(
    `DELETE FROM reminder_log WHERE sent_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
  );
  if (result.rowCount > 0) {
    console.log(`Pruned ${result.rowCount} reminder log records older than ${RETENTION_DAYS} days.`);
  }
}

async function logReminder({ clientId, customerName, customerPhone, messageContent, status, errorDetail = null }) {
  await pool.query(
    `INSERT INTO reminder_log (client_id, customer_name, customer_phone, message_content, status, error_detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [clientId, customerName, customerPhone, messageContent, status, errorDetail]
  );
}

// Get the most recent reminder sent to a specific customer (useful for
// avoiding duplicate sends, or checking "have we already reminded them?")
async function getLastReminder(clientId, customerPhone) {
  const result = await pool.query(
    `SELECT * FROM reminder_log WHERE client_id = $1 AND customer_phone = $2
     ORDER BY sent_at DESC LIMIT 1`,
    [clientId, customerPhone]
  );
  return result.rows[0] || null;
}

module.exports = { ensureTable, pruneOldRecords, logReminder, getLastReminder, pool };
