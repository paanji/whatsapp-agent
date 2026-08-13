// promptBuilder.js
const fs = require('fs');
const path = require('path');
const { buildSystemPrompt } = require('./basePrompt');

const CLIENTS_DIR = path.join(__dirname, 'clients');

function loadClient(clientId) {
  const clientDir = path.join(CLIENTS_DIR, clientId);
  if (!fs.existsSync(clientDir)) {
    throw new Error(`Unknown client: ${clientId}`);
  }

  const config = JSON.parse(fs.readFileSync(path.join(clientDir, 'config.json'), 'utf8'));

  // Load whatever knowledge base files exist in the client's folder (md, csv, txt)
  const kbFiles = fs.readdirSync(clientDir).filter(f => f !== 'config.json');
  const knowledgeBaseBlock = kbFiles
    .map(f => {
      const content = fs.readFileSync(path.join(clientDir, f), 'utf8');
      return `## File: ${f}\n${content}`;
    })
    .join('\n\n');

  return { config, knowledgeBaseBlock };
}

function renderMessage(msgConfig, businessName) {
  const text = msgConfig.custom_text || msgConfig.default_text;
  return text.replace('{business_name}', businessName);
}

function buildPromptForClient(clientId) {
  const { config, knowledgeBaseBlock } = loadClient(clientId);
  const { business_profile, customizable_messages } = config;

  const customMessagesBlock = Object.entries(customizable_messages)
    .map(([key, msgConfig]) => `- ${key}: "${renderMessage(msgConfig, business_profile.business_name)}"`)
    .join('\n');

  const systemPrompt = buildSystemPrompt({
    businessName: business_profile.business_name,
    primaryGoal: business_profile.primary_goal,
    customMessagesBlock,
    knowledgeBaseBlock,
  });

  // The literal text the backend should substitute in for the handoff tag before sending to the user
  const handoffMessage = renderMessage(customizable_messages.human_handoff_message, business_profile.business_name);

  return { systemPrompt, handoffMessage };
}

module.exports = { buildPromptForClient, loadClient };
