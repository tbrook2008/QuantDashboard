const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiProvider {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }
  
  async analyze(systemPrompt, userPrompt) {
    const model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-pro",
      systemInstruction: systemPrompt
    });
    
    const result = await model.generateContent(userPrompt);
    return result.response.text();
  }
}

module.exports = GeminiProvider;
