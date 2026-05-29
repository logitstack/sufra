/**
 * Anthropic API wrapper used by the ingester.
 * Runs only on the server. ANTHROPIC_API_KEY must be set.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_SONNET = 'claude-sonnet-4-5';   // Extraction (text + vision)
const MODEL_HAIKU  = 'claude-haiku-4-5';    // Normalization (cheap, fast)

type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string | MessageContent[];
};

export async function callClaude({
  model = MODEL_SONNET,
  system,
  messages,
  maxTokens = 4096
}: {
  model?: string;
  system?: string;
  messages: AnthropicMessage[];
  maxTokens?: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  // Concatenate all text content blocks
  const text = (data.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n');
  return text;
}

export { MODEL_SONNET, MODEL_HAIKU };
