import { generateAIResponse } from './ai';

export async function summarizeContent(content: string, apiKey: string): Promise<string> {
  if (!apiKey) {
    return "No Gemini API key configured. Add it in Settings.";
  }
  try {
    return await generateAIResponse({
      provider: 'gemini',
      geminiKey: apiKey
    }, {
      prompt: `Summarize the following research content in 3 concise bullet points for a study dashboard: ${content}`,
      systemInstruction: "You are an expert academic curator. Your summaries are precise, architectural, and insightful."
    });
  } catch (error) {
    console.error("Gemini Error:", error);
    return "Could not generate summary at this time.";
  }
}

export async function classifyContent(items: string[], apiKey: string): Promise<Array<{item: string, type: 'youtube' | 'link' | 'file' | 'note', title: string}>> {
  const results = items.map(item => {
    const trimmed = item.trim();
    if (!trimmed) return null;
    
    if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
      return { item: trimmed, type: 'youtube' as const, title: trimmed };
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return { item: trimmed, type: 'link' as const, title: trimmed };
    }
    const extensions = ['.pdf', '.mp4', '.jpg', '.jpeg', '.png', '.zip', '.docx', '.pptx', '.xlsx', '.txt', '.md'];
    if (extensions.some(ext => trimmed.toLowerCase().endsWith(ext))) {
      return { item: trimmed, type: 'file' as const, title: trimmed.split(/[\\/]/).pop() || trimmed };
    }
    return { item: trimmed, type: 'note' as const, title: trimmed.substring(0, 80) };
  });
  
  return results.filter(Boolean) as any[];
}
