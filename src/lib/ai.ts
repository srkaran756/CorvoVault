import { GoogleGenAI } from "@google/genai";

export type AIProvider = 'gemini' | 'openrouter' | 'openai' | 'anthropic';

export interface AIServiceConfig {
  provider: AIProvider;
  geminiKey?: string;
  openrouterKey?: string;
  openaiKey?: string;
  anthropicKey?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIGenerateOptions {
  prompt?: string;
  systemInstruction?: string;
  messages?: ChatMessage[];
  model?: string;
  responseFormat?: { type: 'json_object' };
}

export async function generateAIResponse(
  config: AIServiceConfig,
  options: AIGenerateOptions,
  out?: { modelUsed?: string }
): Promise<string> {
  const provider = config.provider || 'gemini';

  // Helper to resolve messages array for OpenAI-compatible and other APIs
  const rawMessages = options.messages || [
    ...(options.systemInstruction
      ? [{ role: 'system' as const, content: options.systemInstruction }]
      : []),
    { role: 'user' as const, content: options.prompt ?? '' }
  ];

  switch (provider) {
    case 'gemini': {
      const key = (config.geminiKey || '').trim();
      if (!key) throw new Error('Gemini API Key is missing. Please add it in Settings.');
      
      const ai = new GoogleGenAI({ apiKey: key });

      // For Gemini, extract system instructions to the config.systemInstruction parameter
      const systemMsg = rawMessages.find(m => m.role === 'system');
      const systemInstruction = systemMsg?.content || options.systemInstruction;
      const chatMessages = rawMessages.filter(m => m.role !== 'system');

      const contents = chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const modelUsed = options.model || 'gemini-2.0-flash';
      if (out) out.modelUsed = modelUsed;

      const response = await ai.models.generateContent({
        model: modelUsed,
        contents: contents.length > 0 ? contents : (options.prompt || ''),
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(options.responseFormat?.type === 'json_object' ? { responseMimeType: 'application/json' } : {})
        }
      });
      return response.text || 'No response generated.';
    }

    case 'openrouter': {
      const key = (config.openrouterKey || '').trim();
      if (!key) throw new Error('OpenRouter API Key is missing. Please add it in Settings.');
      
      const model = options.model || 'meta-llama/llama-3.3-70b-instruct:free';
      
      const makeRequest = async (modelName: string) => {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: rawMessages.map(m => ({
              role: m.role,
              content: m.content
            })),
            response_format: options.responseFormat,
            max_tokens: 2500
          })
        });

        if (!response.ok) {
          const errText = await response.text();
          let errMsg = `OpenRouter request failed for ${modelName}`;
          try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message || errMsg;
          } catch {
            errMsg = `${errMsg}: ${response.statusText || response.status}`;
          }
          throw new Error(errMsg);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || 'No response generated.';
        
        // Filter out Nvidia Content Safety dummy response
        if (content.includes("User Safety:") && content.includes("Response Safety:") && content.length < 150) {
          throw new Error("Content safety moderation dummy response detected.");
        }
        
        if (out) out.modelUsed = modelName;
        return content;
      };

      try {
        return await makeRequest(model);
      } catch (err: any) {
        console.warn(`[OpenRouter] Primary model ${model} failed, trying fallbacks:`, err.message);
        const fallbacks = [
          'meta-llama/llama-3.1-8b-instruct:free',
          'qwen/qwen3-coder:free',
          'openrouter/free'
        ];
        
        for (const fallbackModel of fallbacks) {
          if (fallbackModel === model) continue;
          try {
            console.log(`[OpenRouter] Retrying with fallback model: ${fallbackModel}`);
            return await makeRequest(fallbackModel);
          } catch (retryErr: any) {
            console.warn(`[OpenRouter] Fallback model ${fallbackModel} failed:`, retryErr.message);
          }
        }
        throw err;
      }
    }

    case 'openai': {
      const key = (config.openaiKey || '').trim();
      if (!key) throw new Error('OpenAI API Key is missing. Please add it in Settings.');
      
      const model = options.model || 'gpt-4o-mini';
      if (out) out.modelUsed = model;
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
          model: model,
          messages: rawMessages.map(m => ({
            role: m.role,
            content: m.content
          })),
          response_format: options.responseFormat
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = 'OpenAI request failed';
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errMsg;
        } catch {
          errMsg = `${errMsg}: ${response.statusText || response.status}`;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || 'No response generated.';
    }

    case 'anthropic': {
      const key = (config.anthropicKey || '').trim();
      if (!key) throw new Error('Anthropic API Key is missing. Please add it in Settings.');
      
      const model = options.model || 'claude-3-5-haiku-20241022';
      if (out) out.modelUsed = model;

      const systemMsg = rawMessages.find(m => m.role === 'system');
      const systemInstruction = systemMsg?.content || options.systemInstruction;
      const chatMessages = rawMessages.filter(m => m.role !== 'system');

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'dangerously-allow-developer-user-access': 'true'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 1024,
          system: systemInstruction,
          messages: chatMessages.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
          }))
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = 'Anthropic request failed';
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error?.message || errMsg;
        } catch {
          errMsg = `${errMsg}: ${response.statusText || response.status}`;
        }
        throw new Error(errMsg);
      }

      const data = await response.json();
      return data.content?.[0]?.text || 'No response generated.';
    }

    default:
      throw new Error(`Unsupported AI Provider: ${provider}`);
  }
}

// ─── Professor Architecture Functions ────────────────────────────────────

import { ProfessorResponse } from '../types';

const PROFESSOR_TOOL_SCHEMA = {
  name: 'professor_response',
  description: 'The professor structured teaching response with speech, annotations, and board actions',
  parameters: {
    type: 'object',
    required: ['speech'],
    properties: {
      speech: { type: 'string', description: 'Teaching response. Markdown supported.' },
      pdf_annotations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['type', 'page', 'targetText', 'color'],
          properties: {
            type: { type: 'string', enum: ['highlight', 'underline', 'circle', 'arrow'] },
            page: { type: 'integer' },
            targetText: { type: 'string' },
            color: { type: 'string' },
            callout: { type: 'string' }
          }
        }
      },
      board_actions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['tool', 'content', 'position', 'style', 'timing'],
          properties: {
            tool: { type: 'string', enum: ['chalk', 'marker', 'erase'] },
            content: { type: 'string' },
            position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
            style: { type: 'object', properties: { color: { type: 'string' }, size: { type: 'number' }, emphasis: { type: 'string' } }, required: ['color', 'size'] },
            timing: { type: 'integer' }
          }
        }
      },
      agenda_update: { type: 'array', items: { type: 'string' } },
      student_model_delta: {
        type: 'object',
        properties: {
          now_understood: { type: 'array', items: { type: 'string' } },
          now_confused: { type: 'array', items: { type: 'string' } }
        }
      },
      navigate_to_page: { type: 'integer', description: 'Optional 1-indexed page number to navigate/jump the user to (e.g. if discussing a topic located on that page).' }
    }
  }
};

export async function generateProfessorResponse(
  config: AIServiceConfig,
  messages: ChatMessage[],
  model?: string
): Promise<ProfessorResponse> {
  const provider = config.provider || 'gemini';

  if (provider === 'gemini') {
    const modelUsed = model || 'gemini-2.0-flash';
    try {
      const key = (config.geminiKey || '').trim();
      if (!key) throw new Error('Gemini API Key is missing.');
      const ai = new GoogleGenAI({ apiKey: key });

      const systemMsg = messages.find(m => m.role === 'system');
      const systemInstruction = systemMsg?.content;
      const chatMessages = messages.filter(m => m.role !== 'system');

      const contents = chatMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await ai.models.generateContent({
        model: modelUsed,
        contents: contents.length > 0 ? contents : 'Hello',
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: PROFESSOR_TOOL_SCHEMA.parameters as any
        }
      });

      const text = response.text || '{}';
      const result = normalizeProfessorResponse(safeParseJson(text));
      result.modelNameUsed = modelUsed;
      return result;
    } catch (err: any) {
      console.warn('[Professor] Gemini structured call failed, falling back:', err.message);
      return await tryJsonPromptFallback(config, messages, modelUsed);
    }
  }

  if (provider === 'openai' || provider === 'openrouter') {
    try {
      return await tryFunctionCalling(config, messages, model);
    } catch (err: any) {
      console.warn('[Professor] Function calling failed, trying JSON prompt fallback:', err.message);
      return await tryJsonPromptFallback(config, messages, model);
    }
  }

  return await tryJsonPromptFallback(config, messages, model);
}

async function tryFunctionCalling(
  config: AIServiceConfig,
  messages: ChatMessage[],
  model?: string
): Promise<ProfessorResponse> {
  const provider = config.provider;
  const key = provider === 'openrouter' ? config.openrouterKey : config.openaiKey;
  const baseUrl = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';

  let finalModelUsed = '';
  const makeCall = async (modelName: string) => {
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: modelName,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: 2500,
        tools: [{ type: 'function', function: PROFESSOR_TOOL_SCHEMA }],
        tool_choice: { type: 'function', function: { name: 'professor_response' } }
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error('No tool call in response');

    // Filter out Nvidia Content Safety dummy response in tool arguments
    if (args.includes("User Safety:") && args.includes("Response Safety:") && args.length < 150) {
      throw new Error("Content safety moderation dummy response detected.");
    }

    finalModelUsed = modelName;
    const result = normalizeProfessorResponse(safeParseJson(args));
    result.modelNameUsed = finalModelUsed;
    return result;
  };

  const startModel = model || (provider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct:free' : 'gpt-4o-mini');

  if (provider === 'openrouter') {
    try {
      return await makeCall(startModel);
    } catch (err: any) {
      console.warn(`[OpenRouter] Function call failed for ${startModel}, trying fallbacks:`, err.message);
      const fallbacks = [
        'meta-llama/llama-3.1-8b-instruct:free',
        'qwen/qwen3-coder:free',
        'openrouter/free'
      ];
      for (const fallbackModel of fallbacks) {
        if (fallbackModel === startModel) continue;
        try {
          console.log(`[OpenRouter] Retrying function call with fallback model: ${fallbackModel}`);
          return await makeCall(fallbackModel);
        } catch (retryErr: any) {
          console.warn(`[OpenRouter] Function call fallback ${fallbackModel} failed:`, retryErr.message);
        }
      }
      throw err;
    }
  } else {
    return await makeCall(startModel);
  }
}

async function tryJsonPromptFallback(
  config: AIServiceConfig,
  messages: ChatMessage[],
  model?: string
): Promise<ProfessorResponse> {
  const jsonInstruction = `\n\nIMPORTANT: Your ENTIRE response must be a single valid JSON object following this schema:
{
  "speech": "teaching message content here",
  "pdf_annotations": [
    { "type": "highlight", "page": 1, "targetText": "text to highlight", "color": "orange", "callout": "optional label" }
  ],
  "board_actions": [
    { "tool": "chalk", "content": "draw this text", "position": { "x": 0.5, "y": 0.5 }, "style": { "color": "white", "size": 24 }, "timing": 500 }
  ],
  "agenda_update": ["optional updated list of topics"],
  "student_model_delta": { "now_understood": [], "now_confused": [] },
  "navigate_to_page": 23
}`;

  const augmented = [
    ...messages.slice(0, -1),
    { ...messages[messages.length - 1], content: messages[messages.length - 1].content + jsonInstruction }
  ];

  const out = { modelUsed: '' };
  const raw = await generateAIResponse(config, { 
    messages: augmented, 
    model,
    responseFormat: { type: 'json_object' }
  }, out);
  const result = normalizeProfessorResponse(safeParseJson(raw));
  result.modelNameUsed = out.modelUsed || model || (config.provider === 'gemini' ? 'gemini-2.0-flash' : config.provider === 'openai' ? 'gpt-4o-mini' : config.provider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct:free' : 'claude-3-5-haiku-20241022');
  return result;
}

function normalizeProfessorResponse(parsed: any): ProfessorResponse {
  return {
    speech: typeof parsed?.speech === 'string' ? parsed.speech : (parsed?.speech ? JSON.stringify(parsed.speech) : 'No speech response.'),
    pdf_annotations: Array.isArray(parsed?.pdf_annotations) ? parsed.pdf_annotations : [],
    board_actions: Array.isArray(parsed?.board_actions) ? parsed.board_actions : [],
    agenda_update: parsed?.agenda_update ?? undefined,
    student_model_delta: parsed?.student_model_delta ?? undefined,
    navigate_to_page: typeof parsed?.navigate_to_page === 'number' ? parsed.navigate_to_page : undefined,
  };
}

function safeParseJson(text: string): any {
  if (!text || !text.trim()) {
    throw new Error('Received an empty response from the AI model.');
  }
  const cleaned = text.replace(/```json|```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON object found in LLM response. Raw response: "${text.slice(0, 500)}"`);
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (err: any) {
    const posMatch = err.message.match(/position (\d+)/);
    let errorContext = '';
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const start = Math.max(0, pos - 60);
      const end = Math.min(jsonMatch[0].length, pos + 60);
      errorContext = ` Context around error: "...${jsonMatch[0].slice(start, pos)}[ERROR HERE]${jsonMatch[0].slice(pos, end)}..."`;
    }
    throw new Error(`Failed to parse JSON object: ${err.message}.${errorContext} Raw response: "${text.slice(0, 3000)}"`);
  }
}
