import { createContext, useContext, type ReactNode } from 'react';
import type { StreamingOneshot } from './streamingProxy';

/**
 * React Context that exposes the panel's streamingOneshot proxy to any
 * descendant component without prop drilling. Used by:
 *
 *   - MermaidBlock — to ask the LLM to heal a diagram that failed to parse.
 *   - ArtifactBlock — to refine an HTML artifact given user feedback.
 *   - Future block-level "fix this for me" affordances.
 *
 * App.tsx wraps the panel root in <LlmProvider value={streamingOneshot}>.
 * Components below read it via useLlm(). The value is `null` until
 * the panel mounts and instantiates the proxy — consumers must handle
 * the null case.
 */
const LlmContext = createContext<StreamingOneshot | null>(null);

export function LlmProvider({
  value,
  children,
}: {
  value: StreamingOneshot;
  children: ReactNode;
}) {
  return <LlmContext.Provider value={value}>{children}</LlmContext.Provider>;
}

export function useLlm(): StreamingOneshot | null {
  return useContext(LlmContext);
}
