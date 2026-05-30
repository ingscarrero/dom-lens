import type { LmChatPayload } from '@/lib/bridge/protocol';
import type { Settings } from '@/lib/storage/settings';
import { MERMAID_RULES, ARTIFACT_RULES } from '@/lib/llm/rules';

/**
 * Heal-with-AI prompts used by the block-level retry affordances on
 * MermaidBlock (when the parser rejects the diagram) and ArtifactBlock
 * (when the user wants to refine the HTML).
 *
 * Both prompts keep the same structure: the system message is the
 * relevant rules block + a strict "output ONLY a fenced block"
 * directive, and the user message ships the broken source + (when
 * present) the parser error or the user's refinement intent.
 */

export function buildMermaidHealPayload(
  source: string,
  errorMessage: string,
  settings: Settings,
): LmChatPayload {
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `You are fixing a broken Mermaid diagram. Output ONLY a single \`\`\`mermaid fenced code block — no preamble, no commentary, no apology. Preserve the diagram's INTENT (same nodes/edges/structure) — only fix what the parser rejected.\n\n${MERMAID_RULES}`,
      },
      {
        role: 'user',
        content: [
          'Parser error:',
          errorMessage,
          '',
          'Broken source:',
          '```mermaid',
          source,
          '```',
          '',
          'Return the fixed version inside a single ```mermaid fenced block.',
        ].join('\n'),
      },
    ],
  };
}

export function buildArtifactRefinePayload(
  source: string,
  hint: string,
  settings: Settings,
): LmChatPayload {
  const userIntent = hint.trim();
  return {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey || undefined,
    model: settings.model,
    temperature: userIntent ? 0.3 : 0.1,
    messages: [
      {
        role: 'system',
        content: `You are refining an HTML artifact. Output ONLY a single \`\`\`html fenced code block — no preamble, no commentary. Preserve the artifact's INTENT — apply the requested refinement when present, or fix obvious issues when no intent is given.\n\n${ARTIFACT_RULES}`,
      },
      {
        role: 'user',
        content: [
          userIntent ? 'Requested refinement: ' + userIntent : 'No specific request — improve readability, fix any obvious markup issues, and ensure all the ARTIFACT_RULES constraints are honoured.',
          '',
          'Current artifact:',
          '```html',
          source,
          '```',
          '',
          'Return the refined version inside a single ```html fenced block.',
        ].join('\n'),
      },
    ],
  };
}

/**
 * Pull the fenced code out of an LLM response. Tolerates leading prose
 * (some models still preface despite our "no preamble" instruction).
 */
export function extractFenced(response: string, fence: 'mermaid' | 'html'): string | null {
  const exact = new RegExp('```' + fence + '\\s*\\n([\\s\\S]*?)```', 'i');
  const m1 = response.match(exact);
  if (m1) return m1[1].trimEnd();
  // Fall back to any fenced block
  const any = response.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/);
  if (any) return any[1].trimEnd();
  return null;
}
