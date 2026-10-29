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

/** Server-side web search, for answers grounded in published pages. */
export const WEB_SEARCH_TOOL: Anthropic.Beta.BetaToolUnion = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 };

/** How many times a paused server-tool turn is resumed before giving up. */
const MAX_CONTINUATIONS = 4;

/**
 * Ask Claude for JSON matching `schema`.
 * `effort` trades depth for speed; extraction work is fine at 'medium'.
 * `tools` takes server tools such as WEB_SEARCH_TOOL; a turn they pause
 * (stop_reason 'pause_turn') is sent back so the server picks up where it
 * left off.
 */
export async function claudeJson<T extends z.ZodType>({
  system,
  content,
  schema,
  effort = 'medium',
  maxTokens = 16000,
  tools
}: {
  system: string;
  content: UserContent;
  schema: T;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  tools?: Anthropic.Beta.BetaToolUnion[];
}): Promise<z.infer<T>> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];
  const request = () => getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    ...(tools ? { tools } : {}),
    output_config: { effort, format: betaZodOutputFormat(schema) }
  });

  let response = await request();
  for (let i = 0; response.stop_reason === 'pause_turn' && i < MAX_CONTINUATIONS; i++) {
    messages.push({ role: 'assistant', content: response.content });
    response = await request();
  }
  if (response.stop_reason === 'pause_turn') {
    throw new Error('Claude took too long searching. Try again.');
  }

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
