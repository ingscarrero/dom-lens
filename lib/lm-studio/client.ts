import type { ChatMessage, LmChatPayload } from '../bridge/protocol';

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export async function* chatStream(
  payload: LmChatPayload,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const url = payload.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const body = {
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature ?? 0.2,
    stream: true,
  };
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (payload.apiKey) headers.Authorization = `Bearer ${payload.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LM Studio HTTP ${res.status}: ${text || res.statusText}`);
  }
  if (!res.body) throw new Error('LM Studio returned no response body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nlIndex: number;
      while ((nlIndex = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nlIndex).trim();
        buf = buf.slice(nlIndex + 1);
        if (!line) continue;
        if (line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length) {
            yield { delta, done: false };
          }
          if (json?.choices?.[0]?.finish_reason) {
            yield { delta: '', done: true };
            return;
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
  yield { delta: '', done: true };
}

export async function listModels(
  baseUrl: string,
  apiKey?: string,
): Promise<{ ok: true; models: string[] } | { ok: false; message: string }> {
  try {
    const url = baseUrl.replace(/\/$/, '') + '/models';
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status} ${res.statusText}` };
    }
    const json = await res.json();
    const models: string[] = (json?.data ?? []).map((m: any) => m.id).filter(Boolean);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function buildSnapshotPrompt(
  userMessage: string,
  snapshotMarkdown: string | undefined,
  screenshotDataUrl: string | undefined,
  extras: { reactSummary?: string; federationSummary?: string; consoleSummary?: string },
): ChatMessage {
  const parts: string[] = [];
  if (snapshotMarkdown) {
    parts.push('## Page DOM (semantic markdown)\n\n' + snapshotMarkdown);
  }
  if (extras.reactSummary) parts.push('## React component tree\n\n' + extras.reactSummary);
  if (extras.federationSummary) parts.push('## Module Federation\n\n' + extras.federationSummary);
  if (extras.consoleSummary) parts.push('## Console\n\n' + extras.consoleSummary);
  parts.push('## User question\n\n' + userMessage);

  const text = parts.join('\n\n---\n\n');

  if (!screenshotDataUrl) {
    return { role: 'user', content: text };
  }

  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: screenshotDataUrl } },
    ],
  };
}
