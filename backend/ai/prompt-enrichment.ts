// Prompt Enrichment Module - Enhances short/vague prompts using OpenAI
import { getClient } from './llm.js';

/**
 * Enriches a short or vague prompt into a detailed, actionable prompt
 * using OpenAI's language model.
 * 
 * @param prompt - The original user prompt
 * @param options - Configuration options
 * @returns Enhanced prompt with more detail and clarity
 */
export async function enrichPrompt(
  prompt: string,
  options: {
    minWords?: number;
    maxEnhancedWords?: number;
    temperature?: number;
    context?: string;
  } = {}
): Promise<{
  enhanced: string;
  wasEnhanced: boolean;
  originalWordCount: number;
  enhancedWordCount: number;
}> {
  const {
    minWords = 16,
    maxEnhancedWords = 300,
    temperature = 0.3,
    context = 'general'
  } = options;

  // Count words in original prompt
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  const originalWordCount = words.length;

  // If prompt is already detailed, return as-is
  if (originalWordCount >= minWords) {
    return {
      enhanced: prompt,
      wasEnhanced: false,
      originalWordCount,
      enhancedWordCount: originalWordCount
    };
  }

  try {
    const client = await getClient();

    // System instruction for prompt engineer
    const systemPrompt = [
      'You are a world-class prompt engineer specializing in creating clear, actionable prompts.',
      'Your task is to transform brief user requests into detailed, structured prompts.',
      'Focus on:',
      '- Specificity: Define exact requirements and constraints',
      '- Clarity: Use clear, unambiguous language',
      '- Structure: Organize information logically',
      '- Context: Add relevant domain knowledge',
      '- Acceptance criteria: Define what success looks like',
      `Keep the enhanced prompt under ${maxEnhancedWords} words.`
    ].join(' ');

    // User message requesting enhancement
    const userMessage = [
      `Context: ${context}`,
      '',
      'Original brief:',
      '---',
      prompt,
      '---',
      '',
      'Please enhance this brief into a detailed, actionable prompt.',
      'Return ONLY the enhanced prompt text, no JSON or extra formatting.'
    ].join('\n');

    // Call LLM for enhancement
    const response = await client.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      stream: false,
      options: { temperature }
    });

    // Extract enhanced text
    const enhanced = (
      (response as any)?.response || 
      (response as any)?.message?.content || 
      (response as any)?.content || 
      ''
    ).trim();

    // Validate we got a meaningful enhancement
    if (!enhanced || enhanced.length < prompt.length) {
      return {
        enhanced: prompt,
        wasEnhanced: false,
        originalWordCount,
        enhancedWordCount: originalWordCount
      };
    }

    const enhancedWords = enhanced.split(/\s+/).filter(Boolean);
    const enhancedWordCount = enhancedWords.length;

    return {
      enhanced,
      wasEnhanced: true,
      originalWordCount,
      enhancedWordCount
    };

  } catch (error: any) {
    // On error, return original prompt
    console.error('[prompt-enrichment] Error enhancing prompt:', error.message);
    return {
      enhanced: prompt,
      wasEnhanced: false,
      originalWordCount,
      enhancedWordCount: originalWordCount
    };
  }
}

/**
 * Convenience function for simple use cases
 */
export async function maybeEnhancePrompt(prompt: string): Promise<string> {
  const result = await enrichPrompt(prompt);
  return result.enhanced;
}
