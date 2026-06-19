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
          max_tokens: 4096,
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
      thinking: { type: 'string', description: 'The inner monologue or reasoning process. Use this to think step-by-step about what information is needed, evaluate current evidence, and plan annotations/board drawings before writing the speech.' },
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

export const RETRIEVAL_TOOLS = [
  {
    name: 'search_chunks',
    description: 'NAVIGATION TOOL: Search the document index for references matching the semantic query. Returns references: { chunk_id, page, section, chapter_id }. You MUST call a Reading Tool (e.g. get_page, get_topic, get_section) on these references to retrieve full authoritative content before generating an answer.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_page',
    description: 'READING TOOL: Retrieve the full verbatim text of a specific page.',
    parameters: {
      type: 'object',
      properties: {
        page_number: { type: 'integer', description: 'The 1-indexed page number to read.' }
      },
      required: ['page_number']
    }
  },
  {
    name: 'get_page_range',
    description: 'READING TOOL: Retrieve the full verbatim text of a range of pages (inclusive).',
    parameters: {
      type: 'object',
      properties: {
        start_page: { type: 'integer', description: 'The starting page number.' },
        end_page: { type: 'integer', description: 'The ending page number.' }
      },
      required: ['start_page', 'end_page']
    }
  },
  {
    name: 'get_topic',
    description: 'READING TOOL: Retrieve all content associated with the requested topic name.',
    parameters: {
      type: 'object',
      properties: {
        topic_name: { type: 'string', description: 'The topic name to read.' }
      },
      required: ['topic_name']
    }
  },
  {
    name: 'get_section',
    description: 'READING TOOL: Retrieve all content associated with the requested section name or title.',
    parameters: {
      type: 'object',
      properties: {
        section_title: { type: 'string', description: 'The section name/title to read.' }
      },
      required: ['section_title']
    }
  },
  {
    name: 'get_chapter',
    description: 'READING TOOL: Retrieve all content associated with the requested chapter ID or number (e.g. chapter_3 or 3).',
    parameters: {
      type: 'object',
      properties: {
        chapter_id: { type: 'string', description: 'The chapter ID or number to read.' }
      },
      required: ['chapter_id']
    }
  },
  {
    name: 'get_neighbor_pages',
    description: 'READING TOOL: Retrieve the full text of pages surrounding a center page.',
    parameters: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Center page number.' },
        before: { type: 'integer', description: 'Number of pages to read before the center page.' },
        after: { type: 'integer', description: 'Number of pages to read after the center page.' }
      },
      required: ['page', 'before', 'after']
    }
  },
  {
    name: 'lookup_metadata',
    description: 'NAVIGATION TOOL: Retrieve detailed metadata and boundaries for a specific chunk ID.',
    parameters: {
      type: 'object',
      properties: {
        chunk_id: { type: 'string', description: 'The chunk ID to look up.' }
      },
      required: ['chunk_id']
    }
  },
  {
    name: 'list_topics',
    description: 'NAVIGATION TOOL: List all topics available in the document concept index along with their pages.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_sections',
    description: 'NAVIGATION TOOL: List all unique section headings and chapters available in the document along with their pages.',
    parameters: {
      type: 'object',
      properties: {}
    }
  }
];

async function executeRetrievalTool(
  materialId: string | undefined,
  toolName: string,
  args: any
): Promise<any> {
  if (!materialId) {
    return { error: 'No material ID was provided to run this tool.' };
  }
  const api = (window as any).electronAPI;
  if (api && typeof api.invoke === 'function') {
    try {
      console.log(`[ai.ts] Executing retrieval tool via IPC: ${toolName}`, args);
      return await api.invoke('professor:runRetrievalTool', materialId, toolName, args);
    } catch (e: any) {
      console.error(`[ai.ts] Retrieval tool execution failed:`, e);
      return { error: e.message || 'Tool execution encountered an error.' };
    }
  }
  return { error: 'Electron API invoke is not available in this environment.' };
}

export function repairJson(jsonStr: string): string {
  let str = jsonStr.trim();
  
  // Find first '{'
  const firstBrace = str.indexOf('{');
  if (firstBrace === -1) return '{}';
  str = str.substring(firstBrace);
  
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let repaired = '';
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (inString) {
      if (escaped) {
        escaped = false;
        repaired += char;
      } else if (char === '\\') {
        escaped = true;
        repaired += char;
      } else if (char === '"') {
        inString = false;
        repaired += char;
      } else if (char === '\n' || char === '\r') {
        repaired += '\\n';
      } else {
        repaired += char;
      }
    } else {
      if (char === '"') {
        inString = true;
        repaired += char;
      } else if (char === '{' || char === '[') {
        stack.push(char);
        repaired += char;
      } else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '{') {
          stack.pop();
        }
        repaired += char;
      } else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === '[') {
          stack.pop();
        }
        repaired += char;
      } else {
        repaired += char;
      }
    }
  }
  
  if (inString) {
    if (escaped) {
      repaired = repaired.slice(0, -1);
    }
    repaired += '"';
  }
  
  // Clean up trailing commas, colons, or trailing keys
  repaired = repaired.trim();
  
  // Strip trailing colon key patterns
  repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  repaired = repaired.replace(/\{\s*"[^"]*"\s*:\s*$/, '{');
  
  if (repaired.endsWith(',')) {
    repaired = repaired.slice(0, -1);
  }
  
  while (stack.length > 0) {
    const last = stack.pop();
    repaired = repaired.trim();
    if (repaired.endsWith(',')) {
      repaired = repaired.slice(0, -1);
    }
    if (last === '{') {
      repaired += '}';
    } else if (last === '[') {
      repaired += ']';
    }
  }
  
  return repaired;
}

export async function generateProfessorResponse(
  config: AIServiceConfig,
  messages: ChatMessage[],
  model?: string,
  materialId?: string,
  onToolCall?: (toolName: string, args: any, result: any) => void,
  onStream?: (chunk: { thinking?: string; speech?: string }) => void
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

      let iteration = 0;
      const maxIterations = (config as any).maxAgentIterations ?? 8;

      while (iteration < maxIterations) {
        iteration++;
        
        // Use streaming if it's the final output round (or always for live text generation)
        const responseStream = await ai.models.generateContentStream({
          model: modelUsed,
          contents: contents.length > 0 ? contents : 'Hello',
          config: {
            systemInstruction,
            tools: [{
              functionDeclarations: [
                PROFESSOR_TOOL_SCHEMA,
                ...RETRIEVAL_TOOLS
              ] as any
            }]
          }
        });

        let hasFinalResponse = false;
        let finalResponseArgs: any = null;
        let functionCallsToExecute: any[] = [];
        let accumulatedText = '';

        for await (const chunk of responseStream) {
          const fcList = chunk.functionCalls;
          if (fcList && fcList.length > 0) {
            for (const call of fcList) {
              if (call.name === 'professor_response') {
                hasFinalResponse = true;
                if (call.args) {
                  finalResponseArgs = call.args;
                  if (onStream) {
                    onStream({
                      thinking: (call.args as any).thinking || '',
                      speech: (call.args as any).speech || ''
                    });
                  }
                }
              } else {
                functionCallsToExecute.push(call);
              }
            }
          } else if (chunk.text) {
            accumulatedText += chunk.text;
            if (onStream) {
              // Try parsing streaming raw JSON text if any, or stream text directly
              try {
                const repaired = JSON.parse(repairJson(accumulatedText));
                onStream({
                  thinking: repaired.thinking || '',
                  speech: repaired.speech || ''
                });
              } catch {
                onStream({
                  speech: accumulatedText
                });
              }
            }
          }
        }

        if (functionCallsToExecute.length > 0) {
          // Push model turn containing tool calls to contents
          contents.push({
            role: 'model',
            parts: functionCallsToExecute.map(call => ({
              functionCall: {
                name: call.name,
                args: call.args
              }
            })) as any
          } as any);

          const userParts: any[] = [];
          for (const call of functionCallsToExecute) {
            const toolResult = await executeRetrievalTool(materialId, call.name, call.args);
            if (onToolCall) {
              onToolCall(call.name, call.args, toolResult);
            }
            userParts.push({
              functionResponse: {
                name: call.name,
                response: { output: toolResult }
              }
            });
          }

          // Push user turn containing tool responses to contents
          contents.push({
            role: 'user',
            parts: userParts
          });
        } else if (hasFinalResponse && finalResponseArgs) {
          const result = normalizeProfessorResponse(finalResponseArgs);
          result.modelNameUsed = modelUsed;
          return result;
        } else {
          const result = normalizeProfessorResponse(safeParseJson(accumulatedText || '{}'));
          result.modelNameUsed = modelUsed;
          return result;
        }
      }
      throw new Error(`Agent reached maximum research limit (${maxIterations} steps) without final response.`);
    } catch (err: any) {
      console.warn('[Professor] Gemini agent call failed, falling back:', err.message);
      return await tryJsonPromptFallback(config, messages, modelUsed);
    }
  }

  if (provider === 'openai' || provider === 'openrouter') {
    try {
      const key = provider === 'openrouter' ? config.openrouterKey : config.openaiKey;
      const baseUrl = provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      
      const modelUsed = model || (provider === 'openrouter' ? 'meta-llama/llama-3.3-70b-instruct:free' : 'gpt-4o-mini');

      let loopMessages = messages.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: undefined as any,
        tool_call_id: undefined as any,
        name: undefined as any
      }));

      let iteration = 0;
      const maxIterations = (config as any).maxAgentIterations ?? 8;

      while (iteration < maxIterations) {
        iteration++;
        const res = await fetch(baseUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({
            model: modelUsed,
            messages: loopMessages,
            max_tokens: 2500,
            tools: [
              { type: 'function', function: PROFESSOR_TOOL_SCHEMA },
              ...RETRIEVAL_TOOLS.map(t => ({ type: 'function', function: t }))
            ],
            tool_choice: 'auto',
            stream: true
          })
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error('Response body reader is not available');

        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let accumulatedArgs = '';
        let isProfessorResponseActive = false;
        let streamedToolCalls: any[] = [];
        let accumulatedText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine || cleanLine === 'data: [DONE]') continue;
            if (cleanLine.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(cleanLine.slice(6));
                const choice = parsed.choices?.[0];
                const delta = choice?.delta;

                if (delta?.content) {
                  accumulatedText += delta.content;
                  if (onStream) {
                    try {
                      const repaired = JSON.parse(repairJson(accumulatedText));
                      onStream({
                        thinking: repaired.thinking || '',
                        speech: repaired.speech || ''
                      });
                    } catch {
                      onStream({
                        speech: accumulatedText
                      });
                    }
                  }
                }

                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    if (!streamedToolCalls[idx]) {
                      streamedToolCalls[idx] = {
                        id: tc.id || '',
                        type: 'function',
                        function: { name: tc.function?.name || '', arguments: '' }
                      };
                    }
                    if (tc.id) {
                      streamedToolCalls[idx].id = tc.id;
                    }
                    if (tc.function?.name) {
                      streamedToolCalls[idx].function.name = tc.function.name;
                      if (tc.function.name === 'professor_response') {
                        isProfessorResponseActive = true;
                      }
                    }
                    if (tc.function?.arguments) {
                      streamedToolCalls[idx].function.arguments += tc.function.arguments;
                      if (isProfessorResponseActive) {
                        accumulatedArgs += tc.function.arguments;
                        if (onStream) {
                          try {
                            const repaired = JSON.parse(repairJson(accumulatedArgs));
                            onStream({
                              thinking: repaired.thinking || '',
                              speech: repaired.speech || ''
                            });
                          } catch {
                            // ignore parsing errors on partial strings
                          }
                        }
                      }
                    }
                  }
                }
              } catch {
                // ignore JSON parse error on incomplete chunks
              }
            }
          }
        }

        const validToolCalls = streamedToolCalls.filter(Boolean);

        if (validToolCalls.length > 0) {
          loopMessages.push({
            role: 'assistant',
            content: accumulatedText || null,
            tool_calls: validToolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments
              }
            }))
          } as any);

          let hasFinalResponse = false;
          let finalResponseArgs: any = null;

          for (const toolCall of validToolCalls) {
            const name = toolCall.function.name;
            const argsText = toolCall.function.arguments;
            let args = {};
            try { args = JSON.parse(argsText); } catch {}

            if (name === 'professor_response') {
              hasFinalResponse = true;
              finalResponseArgs = args;
            } else {
              const toolResult = await executeRetrievalTool(materialId, name, args);
              if (onToolCall) {
                onToolCall(name, args, toolResult);
              }
              loopMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: name,
                content: JSON.stringify(toolResult)
              } as any);
            }
          }

          if (hasFinalResponse && finalResponseArgs) {
            const result = normalizeProfessorResponse(finalResponseArgs);
            result.modelNameUsed = modelUsed;
            return result;
          }
        } else {
          const result = normalizeProfessorResponse(safeParseJson(accumulatedText || '{}'));
          result.modelNameUsed = modelUsed;
          return result;
        }
      }
      throw new Error(`Agent reached maximum research limit (${maxIterations} steps) without final response.`);
    } catch (err: any) {
      console.warn('[Professor] OpenAI/OpenRouter agent call failed, trying JSON prompt fallback:', err.message);
      return await tryJsonPromptFallback(config, messages, model);
    }
  }

  return await tryJsonPromptFallback(config, messages, model);
}

async function tryJsonPromptFallback(
  config: AIServiceConfig,
  messages: ChatMessage[],
  model?: string
): Promise<ProfessorResponse> {
  const jsonInstruction = `\n\nIMPORTANT: Your ENTIRE response must be a single valid JSON object following this schema:
{
  "thinking": "optional inner monologue / step-by-step reasoning",
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
    thinking: typeof parsed?.thinking === 'string' ? parsed.thinking : (parsed?.thinking ? JSON.stringify(parsed.thinking) : undefined),
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
    return { speech: 'Received an empty response from the AI model.' };
  }
  const cleaned = text.replace(/```json|```/g, '').trim();
  
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace === -1) {
    return { speech: text };
  }
  
  // Try normal parse first
  try {
    return JSON.parse(cleaned.substring(firstBrace));
  } catch (err: any) {
    // Attempt repair
    try {
      console.warn('[safeParseJson] Normal JSON parsing failed, attempting repairJson...', err.message);
      const repaired = repairJson(cleaned);
      return JSON.parse(repaired);
    } catch (repairErr: any) {
      console.warn('[safeParseJson] JSON parsing and repair failed, falling back to plain text wrapping.');
      return { speech: text };
    }
  }
}
