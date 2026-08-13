// sessionStore.js
// NOTE: In-memory only — fine for testing/demo. For production, swap this
// for Redis or a DB table (key: `${clientId}:${userPhone}`) so history
// survives server restarts and works across multiple server instances.

const sessions = new Map();

function getKey(clientId, userPhone) {
  return `${clientId}:${userPhone}`;
}

function getHistory(clientId, userPhone) {
  return sessions.get(getKey(clientId, userPhone)) || [];
}

function appendMessage(clientId, userPhone, role, content) {
  const key = getKey(clientId, userPhone);
  const history = sessions.get(key) || [];
  history.push({ role, content });
  // Keep last 20 turns to control token usage
  sessions.set(key, history.slice(-20));
}

module.exports = { getHistory, appendMessage };
