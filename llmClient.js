// llmClient.js
const axios = require('axios');

async function getAIReply(systemPrompt, conversationHistory) {
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationHistory, // [{ role: 'user'|'assistant', content: '...' }, ...]
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data.choices[0]?.message?.content || '';
}

module.exports = { getAIReply };
