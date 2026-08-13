// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { buildPromptForClient } = require('./promptBuilder');
const { getHistory, appendMessage } = require('./sessionStore');
const { getAIReply } = require('./llmClient');

const app = express();
app.use(express.json());

const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'clients', 'registry.json'), 'utf8'));

// ---- 1. Webhook verification (Meta requires this GET handshake once, on setup) ----
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ---- 2. Incoming WhatsApp messages ----
app.post('/webhook', async (req, res) => {
  // Acknowledge immediately — WhatsApp requires a fast 200 OK, do real work after
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message) return; // e.g. a status update webhook, not a real message

    const phoneNumberId = change.metadata.phone_number_id; // tells us WHICH client this is
    const userPhone = message.from;
    const userText = message.text?.body || '';

    const clientId = registry[phoneNumberId];
    if (!clientId) {
      console.error(`No client registered for phone_number_id: ${phoneNumberId}`);
      return;
    }

    await handleIncomingMessage({ clientId, phoneNumberId, userPhone, userText });
  } catch (err) {
    console.error('Error handling webhook:', err);
  }
});

async function handleIncomingMessage({ clientId, phoneNumberId, userPhone, userText }) {
  const { systemPrompt, handoffMessage } = buildPromptForClient(clientId);

  appendMessage(clientId, userPhone, 'user', userText);
  const history = getHistory(clientId, userPhone);

  let reply = await getAIReply(systemPrompt, history);

  // ---- Intercept the handoff tag BEFORE it ever reaches the customer ----
  const handoffMatch = reply.match(/\[TRIGGER_HUMAN_HANDOFF:.*?\]/);
  if (handoffMatch) {
    reply = reply.replace(handoffMatch[0], '').trim();
    notifyHumanTeam(clientId, userPhone, handoffMatch[0]);
    if (!reply) reply = handoffMessage; // if Claude sent ONLY the tag, use the configured message
  }

  appendMessage(clientId, userPhone, 'assistant', reply);
  await sendWhatsAppMessage(phoneNumberId, userPhone, reply);
}

// ---- 3. Send a reply back via the WhatsApp Cloud API ----
async function sendWhatsAppMessage(phoneNumberId, toPhone, text) {
  await axios.post(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: toPhone,
      type: 'text',
      text: { body: text },
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

// ---- 4. Stub for alerting a human team member on handoff ----
// Replace with a real Slack webhook, CRM API call, or SMS alert in production.
function notifyHumanTeam(clientId, userPhone, reasonTag) {
  console.log(`[HANDOFF] client=${clientId} user=${userPhone} reason=${reasonTag}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhatsApp agent server running on port ${PORT}`));
