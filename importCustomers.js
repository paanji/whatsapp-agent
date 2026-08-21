// importCustomers.js
// Run this LOCALLY, once, pointing at your real customer CSV, to load it into
// the database. Safe to re-run any time you add new customers or fix a typo —
// it updates existing entries rather than duplicating them.
//
// Usage: node importCustomers.js path/to/your/customers.csv Tomboys
//
// IMPORTANT: Never commit the actual customer CSV file to GitHub. This script
// itself is fine to commit (it contains no customer data), but run it with
// your real file kept only on your own computer.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ensureCustomersTable, upsertCustomer } = require('./customerStore');

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8').trim();
  const [headerLine, ...lines] = content.split('\n');
  const headers = headerLine.split(',').map(h => h.trim());
  return lines.map(line => {
    const values = line.split(',').map(v => v.trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = values[i] || ''));
    return row;
  });
}

async function main() {
  const csvPath = process.argv[2];
  const clientId = process.argv[3];

  if (!csvPath || !clientId) {
    console.error('Usage: node importCustomers.js <path-to-csv> <client-id>');
    console.error('Example: node importCustomers.js ./tomboys_customers.csv Tomboys');
    process.exit(1);
  }

  await ensureCustomersTable();

  const rows = parseCSV(path.resolve(csvPath));
  console.log(`Importing ${rows.length} customers for client "${clientId}"...`);

  let imported = 0, skipped = 0;
  for (const row of rows) {
    const phone = (row.phone || '').replace(/\D/g, '');
    if (phone.length !== 10) {
      console.log(`SKIP (invalid phone): ${row.name} - "${row.phone}"`);
      skipped++;
      continue;
    }
    await upsertCustomer({
      clientId,
      name: row.name,
      phone,
      service: row.service || null,
    });
    imported++;
  }

  console.log(`\nDone. Imported/updated: ${imported}, Skipped: ${skipped}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
