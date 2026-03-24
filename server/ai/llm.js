const { getKey } = require('../keys');

/**
 * Multi-Model LLM Router
 * Spawns concurrent asynchronous tasks via `generateResponse`.
 * Fast/simple requests use 'flash' (Gemini Flash or Claude Haiku).
 * Complex reasoning/trading uses 'pro' (Gemini Pro or Claude Sonnet/Opus).
 */
async function generateResponse(prompt, modelTier = 'flash') {
    const aiKey = getKey('LLM_KEY'); 
    if (!aiKey) throw new Error("LLM API key missing in config.");

    // Simple heuristic: Anthropic keys start with 'sk-ant'
    const isClaude = aiKey.startsWith('sk-ant');

    if (isClaude) {
        const model = modelTier === 'flash' ? 'claude-3-haiku-20240307' : 'claude-3-5-sonnet-20240620';
        return callAnthropic(aiKey, model, prompt);
    } else {
        const model = modelTier === 'flash' ? 'gemini-1.5-flash-latest' : 'gemini-1.5-pro-latest';
        return callGemini(aiKey, model, prompt);
    }
}

async function callAnthropic(key, model, prompt) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: prompt }]
        })
    });
    
    if (!res.ok) {
        const errDesc = await res.text();
        throw new Error(`Anthropic API error: ${res.status} ${errDesc}`);
    }
    const data = await res.json();
    return data.content[0].text;
}

async function callGemini(key, model, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
             'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });
    
    if (!res.ok) {
        const errDesc = await res.text();
        throw new Error(`Gemini API error: ${res.status} ${errDesc}`);
    }
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
}

module.exports = { generateResponse };
