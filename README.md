# WhatsApp SDR Agent — Multi-Tenant

One server, one codebase, many clients. Each client is isolated to a folder under `/clients` — onboarding a new client never requires touching the code.

## How it works
1. WhatsApp sends a message to your webhook (`/webhook`).
2. The server reads `phone_number_id` from the payload and looks it up in `clients/registry.json` to find which client this is.
3. `promptBuilder.js` loads that client's `config.json` (custom messages) + knowledge base files (product catalog, case studies) and merges them into the **fixed** base prompt from `basePrompt.js`.
4. OpenAI (via `llmClient.js`) generates a reply. If it contains `[TRIGGER_HUMAN_HANDOFF: ...]`, the server strips that tag before the customer ever sees it, logs/alerts your team, and swaps in the client's configured handoff message.
5. The reply is sent back via the WhatsApp Cloud API.

## Setup
```bash
npm install
cp .env.example .env   # fill in your real API keys
npm start
```

You'll also need to:
- Register a webhook URL in Meta Business Manager (or your BSP, e.g. Twilio/360dialog) pointing to `https://yourdomain.com/webhook`.
- Set `WHATSAPP_VERIFY_TOKEN` in `.env` to match what you enter in Meta's webhook setup screen.

## Onboarding a new client (no code changes)
1. Create a new folder: `clients/<new-client-id>/`
2. Add `config.json` (copy `clients/flowmetrics/config.json` as a template, edit `business_profile` and any `custom_text` fields you want to override).
3. Drop in their knowledge base files (any `.md`, `.csv`, or `.txt` — product info, pricing, case studies, FAQs). All files in the folder are automatically loaded into the prompt.
4. Add one line to `clients/registry.json`: `"<their_whatsapp_phone_number_id>": "<new-client-id>"`
5. Done — no redeploy of logic needed, just a restart to pick up the new registry entry (or move registry to a DB for zero-downtime updates).

## Production notes (before going live with real clients)
- Swap `sessionStore.js` from in-memory to Redis or a DB table — current version loses history on restart and won't work across multiple server instances.
- Move `clients/registry.json` and each client's `config.json` into a real database once you have more than a handful of clients, so you can build an admin dashboard on top instead of editing JSON files.
- Add logging/monitoring on the `[TRIGGER_HUMAN_HANDOFF]` path — right now it just console.logs; wire it to Slack, email, or your CRM.
- Consider rate limiting and message deduplication (WhatsApp can retry webhook deliveries).
