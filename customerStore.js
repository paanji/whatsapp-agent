// customerStore.js
// Stores the customer list (name, phone, service) in the database instead of
// a local CSV file, so any scheduled/automated process can access it without
// needing a file present on whatever machine runs the job.

const { pool } = require('./reminderLog');

async function ensureCustomersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL,
      name TEXT,
      phone TEXT NOT NULL,
      service TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, phone)
    );
  `);
}

// Adds a customer, or updates their name/service if the phone number already
// exists for this client (so re-running an import is always safe).
async function upsertCustomer({ clientId, name, phone, service }) {
  await pool.query(
    `INSERT INTO customers (client_id, name, phone, service)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client_id, phone)
     DO UPDATE SET name = EXCLUDED.name, service = EXCLUDED.service`,
    [clientId, name, phone, service || null]
  );
}

async function getCustomersForClient(clientId) {
  const result = await pool.query(
    `SELECT name, phone, service FROM customers WHERE client_id = $1 ORDER BY id`,
    [clientId]
  );
  return result.rows;
}

module.exports = { ensureCustomersTable, upsertCustomer, getCustomersForClient };
