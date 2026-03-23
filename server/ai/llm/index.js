const keys = require('../../keys');
const AnthropicProvider = require('./anthropic');
const GeminiProvider = require('./gemini');

function getProvider(userId) {
  const k = keys.getKeys(userId);
  const providerType = k.llmProvider || 'anthropic';
  
  if (providerType === 'gemini') {
    if (!k.geminiKey) return null;
    return new GeminiProvider(k.geminiKey);
  } else {
    if (!k.anthropicKey) return null;
    return new AnthropicProvider(k.anthropicKey);
  }
}

module.exports = { getProvider };
