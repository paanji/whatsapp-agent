// sendReminders.js
// Sends personalized reminders to all of a client's customers, pulling the
// customer list from the database (not a local file) so this can run fully
// unattended on a schedule (e.g. Render Cron Jobs).
//
// Usage: node sendReminders.js <client-id>
// Example: node sendReminders.js Tomboys

require('dotenv').config();
const axios = require('axios');
const { ensureTable, pruneOldRecords, logReminder, getLastReminder } = require('./reminderLog');
const { ensureCustomersTable, getCustomersForClient } = require('./customerStore');

// Per-client settings. Add a new entry here when onboarding a new client's reminders.
const CLIENT_SETTINGS = {
  Tomboys: {
    phoneNumberId: '1274893635709517',
    templateName: 'tomboys_appointment_reminder',
    templateLanguage: 'en',
  },
};

const MIN_DAYS_BETWEEN_REMINDERS = 21; // don't re-remind the same customer within this many days

function toWhatsAppNumber(rawPhone) {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return null;
}

async function sendTemplateMessage(phoneNumberId, templateName, templateLanguage, toNumber, customerName) {
  const response = await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: toNumber,
      type: 'template',
      template: {
        name: templateName,
        language: { code: templateLanguage },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', parameter_name: 'customer_name', text: customerName || 'there' },
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
  const clientId = process.argv[2];
  if (!clientId || !CLIENT_SETTINGS[clientId]) {
    console.error('Usage: node sendReminders.js <client-id>');
    console.error(`Known clients: ${Object.keys(CLIENT_SETTINGS).join(', ')}`);
    process.exit(1);
  }

  const { phoneNumberId, templateName, templateLanguage } = CLIENT_SETTINGS[clientId];

  await ensureTable();
  await ensureCustomersTable();
  await pruneOldRecords();

  const customers = await getCustomersForClient(clientId);
  console.log(`Loaded ${customers.length} customers for "${clientId}" from the database.`);

  let sent = 0, skipped = 0, failed = 0;

  for (const customer of customers) {
    const { name, phone, service } = customer;
    const toNumber = toWhatsAppNumber(phone);

    if (!toNumber) {
      console.log(`SKIP (invalid number): ${name} - "${phone}"`);
      skipped++;
      continue;
    }

    const last = await getLastReminder(clientId, toNumber);
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
      await sendTemplateMessage(phoneNumberId, templateName, templateLanguage, toNumber, name);
      await logReminder({
        clientId,
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
        clientId,
        customerName: name,
        customerPhone: toNumber,
        messageContent: messageSummary,
        status: 'failed',
        errorDetail,
      });
      console.log(`FAILED: ${name} (${toNumber}) — ${errorDetail}`);
      failed++;
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\nDone. Sent: ${sent}, Skipped: ${skipped}, Failed: ${failed}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
