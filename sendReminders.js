// sendReminders.js
// Usage: node sendReminders.js clients/Tomboys/customers.csv
//
// Reads a CSV of customers (name,phone,service), sends each one a
// personalized reminder via the WhatsApp Cloud API using an approved
// message template, and logs every send (success or failure) to the
// database for tracking + 90-day auto-retention.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ensureTable, pruneOldRecords, logReminder, getLastReminder } = require('./reminderLog');

const CLIENT_ID = 'Tomboys';
const PHONE_NUMBER_ID = '1274893635709517'; // TomBoys' registered production number
const TEMPLATE_NAME = 'tomboys_appointment_reminder'; // must match the approved template name exactly
const TEMPLATE_LANGUAGE = 'en';
const MIN_DAYS_BETWEEN_REMINDERS = 21; // don't re-remind the same customer within this many days

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

function toWhatsAppNumber(rawPhone) {
  // Expects 10-digit Indian numbers; adds country code 91.
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return null; // invalid — will be skipped and logged as failed
}

async function sendTemplateMessage(toNumber, customerName, service) {
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: toNumber,
      type: 'template',
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANGUAGE },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'customer_name', text: customerName || 'there' },
              { type: 'text', parameter_name: 'service', text: service || 'HairCut/Shave/D-Tan/Facial' },
            ],
          },
        ],
      },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node sendReminders.js <path-to-customers.csv>');
    process.exit(1);
  }

  await ensureTable();
  await pruneOldRecords();

  const customers = parseCSV(path.resolve(csvPath));
  console.log(`Loaded ${customers.length} customers from ${csvPath}`);

  let sent = 0, skipped = 0, failed = 0;

  for (const customer of customers) {
    const { name, phone, service } = customer;
    const toNumber = toWhatsAppNumber(phone);

    if (!toNumber) {
      console.log(`SKIP (invalid number): ${name} - "${phone}"`);
      skipped++;
      continue;
    }

    // Avoid re-reminding someone too soon
    const last = await getLastReminder(CLIENT_ID, toNumber);
    if (last) {
      const daysSince = (Date.now() - new Date(last.sent_at)) / (1000 * 60 * 60 * 24);
      if (daysSince < MIN_DAYS_BETWEEN_REMINDERS) {
        console.log(`SKIP (reminded ${Math.round(daysSince)} days ago): ${name}`);
        skipped++;
        continue;
      }
    }

    const messageSummary = `Reminder template sent — service: ${service || '(not set)'}`;

    try {
      await sendTemplateMessage(toNumber, name, service);
      await logReminder({
        clientId: CLIENT_ID,
        customerName: name,
        customerPhone: toNumber,
        messageContent: messageSummary,
        status: 'sent',
      });
      console.log(`SENT: ${name} (${toNumber})`);
      sent++;
    } catch (err) {
      const errorDetail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      await logReminder({
        clientId: CLIENT_ID,
        customerName: name,
        customerPhone: toNumber,
        messageContent: messageSummary,
        status: 'failed',
        errorDetail,
      });
      console.log(`FAILED: ${name} (${toNumber}) — ${errorDetail}`);
      failed++;
    }

    // Small delay between sends to avoid hitting rate limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\nDone. Sent: ${sent}, Skipped: ${skipped}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
