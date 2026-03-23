const Anthropic = require('@anthropic-ai/sdk');

class AnthropicProvider {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }
  
  async analyze(systemPrompt, userPrompt) {
    const response = await this.client.messages.create({
      model:      'claude-3-5-sonnet-20241022',
      max_tokens: 800,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    });
    return response.content[0]?.text || '';
  }
}

module.exports = AnthropicProvider;
