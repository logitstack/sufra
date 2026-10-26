/**
 * Anthropic API wrapper. Runs only on the server. ANTHROPIC_API_KEY must be set.
 *
 * Every call returns schema-validated JSON (structured outputs) and opts into
 * server-side refusal fallback.
 */

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';

export const MODEL = 'claude-sonnet-5-5';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  client ??= new Anthropic();
  return client;
}

export type UserContent = Anthropic.Beta.BetaContentBlockParam[] | string;

/**
 * Ask Claude for JSON matching `schema`.
 * `effort` trades depth for speed; extraction work is fine at 'medium'.
 */
export async function claudeJson<T extends z.ZodType>({
  system,
  content,
  schema,
  effort = 'medium',
  maxTokens = 16000
}: {
  system: string;
  content: UserContent;
  schema: T;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: betaZodOutputFormat(schema) }
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined this request. Try different input.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('The response was cut off. Try a shorter input.');
  }
  if (response.parsed_output == null) {
    throw new Error('Could not read the response from Claude.');
  }
  return response.parsed_output as z.infer<T>;
}
