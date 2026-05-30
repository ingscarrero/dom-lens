import { useEffect, useRef } from 'react';
import { useStore, type Tab } from './store';
import { usePort } from './hooks/usePort';
import { useNetwork } from './hooks/useNetwork';
import { loadSettings, onSettingsChanged } from '@/lib/storage/settings';
import SnapshotTab from './tabs/SnapshotTab';
import ComponentsTab from './tabs/ComponentsTab';
import FederationTab from './tabs/FederationTab';
import ModulesTab from './tabs/ModulesTab';
import InsightsTab from './tabs/InsightsTab';
import AnalyzeTab from './tabs/AnalyzeTab';
import SettingsTab from './tabs/SettingsTab';
import type { BgToPanel } from '@/lib/bridge/protocol';
import { runCapture } from './captureFlow';
import { runEnhanceStitch } from './enhanceFlow';
import { callClearHighlight, callHighlight } from './hooks/useInspectedEval';
import { createFetchProxy, createHeadProxy } from '@/lib/modules/fetchProxy';
import { createOneshotProxy } from '@/lib/lm-studio/oneshotProxy';
import { createStreamingProxy, type StreamHandlers } from '@/lib/lm-studio/streamingProxy';

const TABS: { id: Tab; label: string }[] = [
  { id: 'snapshot', label: 'Snapshot' },
  { id: 'components', label: 'Components' },
  { id: 'federation', label: 'Federation' },
  { id: 'modules', label: 'Modules' },
  { id: 'insights', label: 'Insights' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'settings', label: 'Settings' },
];

type NetFetchResolver = (
  r:
    | { ok: true; text: string; status: number; contentType?: string }
    | { ok: false; message: string },
) => void;

type NetHeadResolver = (
  r:
    | { ok: true; status: number; contentType?: string; contentLength?: number }
    | { ok: false; message: string },
) => void;

type OneshotResolver = (r: { ok: true; text: string } | { ok: false; message: string }) => void;

export default function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const capturing = useStore((s) => s.capturing);
  const captureProgress = useStore((s) => s.captureProgress);
  const captureError = useStore((s) => s.captureError);
  const setSettings = useStore((s) => s.setSettings);
  const appendChatDelta = useStore((s) => s.appendChatDelta);
  const endChat = useStore((s) => s.endChat);
  const setTestConnection = useStore((s) => s.setTestConnection);
  const setChatRequestId = useStore((s) => s.setChatRequestId);
  const focused = useStore((s) => s.focused);

  useNetwork();

  // Track in-flight tile.capture promises by requestId
  const tileWaitersRef = useRef(new Map<string, (r: { ok: true; dataUrl: string } | { ok: false; message: string }) => void>());
  // Track in-flight net.fetch promises by requestId
  const netFetchWaitersRef = useRef(new Map<string, NetFetchResolver>());
  // Track in-flight net.head promises by requestId
  const netHeadWaitersRef = useRef(new Map<string, NetHeadResolver>());
  // Track in-flight lm.oneshot promises by requestId
  const oneshotWaitersRef = useRef(new Map<string, OneshotResolver>());
  // Track streaming lm.stream handlers by requestId
  const streamHandlersRef = useRef(new Map<string, StreamHandlers>());

  const port = usePort((msg: BgToPanel) => {
    if (msg.type === 'capture.tile.result') {
      const waiter = tileWaitersRef.current.get(msg.requestId);
      if (waiter) {
        tileWaitersRef.current.delete(msg.requestId);
        if (msg.ok) waiter({ ok: true, dataUrl: msg.dataUrl });
        else waiter({ ok: false, message: msg.message });
      }
    } else if (msg.type === 'net.fetch.result') {
      const waiter = netFetchWaitersRef.current.get(msg.requestId);
      if (waiter) {
        netFetchWaitersRef.current.delete(msg.requestId);
        if (msg.ok)
          waiter({ ok: true, text: msg.text, status: msg.status, contentType: msg.contentType });
        else waiter({ ok: false, message: msg.message });
      }
    } else if (msg.type === 'net.head.result') {
      const waiter = netHeadWaitersRef.current.get(msg.requestId);
      if (waiter) {
        netHeadWaitersRef.current.delete(msg.requestId);
        if (msg.ok)
          waiter({
            ok: true,
            status: msg.status,
            contentType: msg.contentType,
            contentLength: msg.contentLength,
          });
        else waiter({ ok: false, message: msg.message });
      }
    } else if (msg.type === 'lm.oneshot.result') {
      const waiter = oneshotWaitersRef.current.get(msg.requestId);
      if (waiter) {
        oneshotWaitersRef.current.delete(msg.requestId);
        if (msg.ok) waiter({ ok: true, text: msg.text });
        else waiter({ ok: false, message: msg.message });
      }
    } else if (msg.type === 'lm.stream.delta') {
      streamHandlersRef.current.get(msg.requestId)?.onDelta(msg.text);
    } else if (msg.type === 'lm.stream.done') {
      streamHandlersRef.current.get(msg.requestId)?.onDone(msg.fullText);
    } else if (msg.type === 'lm.stream.error') {
      streamHandlersRef.current.get(msg.requestId)?.onError(msg.message);
    } else if (msg.type === 'lm.chat.delta') {
      appendChatDelta(msg.text);
    } else if (msg.type === 'lm.chat.done') {
      endChat();
    } else if (msg.type === 'lm.chat.error') {
      endChat(msg.message);
    } else if (msg.type === 'lm.test.result') {
      setTestConnection(
        msg.ok
          ? { status: 'ok', models: msg.models }
          : { status: 'error', message: msg.message },
      );
    }
  });

  const fetchText = createFetchProxy({
    post: (m) => port.post(m),
    awaitResult: (requestId) =>
      new Promise((resolve) => {
        netFetchWaitersRef.current.set(requestId, resolve);
      }),
  });

  const headProbe = createHeadProxy({
    post: (m) => port.post(m),
    awaitResult: (requestId) =>
      new Promise((resolve) => {
        netHeadWaitersRef.current.set(requestId, resolve);
      }),
  });

  const oneshot = createOneshotProxy({
    post: (m) => port.post(m),
    awaitResult: (requestId) =>
      new Promise((resolve) => {
        oneshotWaitersRef.current.set(requestId, resolve);
      }),
  });

  const streamingOneshot = createStreamingProxy({
    post: (m) => port.post(m),
    registerHandlers: (requestId, handlers) =>
      streamHandlersRef.current.set(requestId, handlers),
    unregisterHandlers: (requestId) => streamHandlersRef.current.delete(requestId),
  });

  useEffect(() => {
    loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, [setSettings]);

  // Sync live page overlay with selected component
  useEffect(() => {
    if (!focused?.bounds) {
      callClearHighlight();
      return;
    }
    callHighlight({
      x: focused.bounds.x,
      y: focused.bounds.y,
      w: focused.bounds.w,
      h: focused.bounds.h,
      label: focused.name,
      color: '#0ea5e9',
    });
  }, [focused]);

  // Best-effort cleanup if the DevTools panel iframe goes away.
  // The background SW also runs a chrome.scripting cleanup on port
  // disconnect — this is just the fast path that runs first.
  useEffect(() => {
    const cleanup = () => {
      try {
        callClearHighlight();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);
    return () => {
      cleanup();
      window.removeEventListener('beforeunload', cleanup);
      window.removeEventListener('pagehide', cleanup);
    };
  }, []);

  const onCapture = async () => {
    const settings = useStore.getState().settings;
    const tabId = chrome.devtools.inspectedWindow.tabId;
    await runCapture(
      {
        tabId,
        post: (m) => port.post(m),
        awaitTileResult: (requestId) =>
          new Promise((resolve) => {
            tileWaitersRef.current.set(requestId, resolve);
          }),
      },
      settings,
    );
  };

  const onAnalyzeCancel = () => {
    const id = useStore.getState().chatRequestId;
    if (id) {
      port.post({ type: 'lm.chat.cancel', requestId: id });
      endChat();
      setChatRequestId(null);
    }
  };

  return (
    <div className="flex h-full flex-col bg-panel-bg text-panel-text">
      <header className="flex items-center justify-between border-b border-panel-border bg-panel-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">DOM Lens</span>
          <span className="text-xs text-panel-muted">v0.3.10</span>
        </div>
        <div className="flex items-center gap-2">
          {capturing && captureProgress && (
            <span className="text-xs text-panel-muted">
              {captureProgress.phase === 'tiles'
                ? `Tile ${captureProgress.step}/${captureProgress.total}…`
                : captureProgress.phase === 'priming'
                  ? 'Priming lazy-loaded content…'
                  : captureProgress.phase}
            </span>
          )}
          <button
            type="button"
            className="rounded bg-panel-accent px-3 py-1 text-xs font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            onClick={onCapture}
            disabled={capturing}
          >
            {capturing ? 'Capturing…' : 'Capture snapshot'}
          </button>
        </div>
      </header>

      {captureError && (
        <div className="border-b border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {captureError}
        </div>
      )}

      <nav className="flex border-b border-panel-border bg-panel-surface">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              'px-3 py-1.5 text-xs ' +
              (tab === t.id
                ? 'border-b-2 border-panel-accent text-white'
                : 'text-panel-muted hover:text-white')
            }
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === 'snapshot' && (
          <SnapshotTab
            onEnhanceWithAI={() =>
              runEnhanceStitch({
                post: (m) => port.post(m),
                awaitOneshot: (requestId) =>
                  new Promise((resolve) => {
                    oneshotWaitersRef.current.set(requestId, resolve);
                  }),
              })
            }
          />
        )}
        {tab === 'components' && <ComponentsTab />}
        {tab === 'federation' && <FederationTab />}
        {tab === 'modules' && (
          <ModulesTab
            fetchText={fetchText}
            oneshot={oneshot}
            streamingOneshot={streamingOneshot}
            headProbe={headProbe}
          />
        )}
        {tab === 'insights' && (
          <InsightsTab
            setTab={setTab}
            onApplyPreset={(preset) => {
              useStore.getState().setPendingPrompt(preset.prompt);
              setTab('analyze');
            }}
          />
        )}
        {tab === 'analyze' && (
          <AnalyzeTab
            onSend={(payload, requestId) => {
              setChatRequestId(requestId);
              port.post({ type: 'lm.chat.start', requestId, payload });
            }}
            onCancel={onAnalyzeCancel}
          />
        )}
        {tab === 'settings' && (
          <SettingsTab
            onTestConnection={(baseUrl, apiKey) =>
              port.post({ type: 'lm.test', baseUrl, apiKey })
            }
          />
        )}
      </main>
    </div>
  );
}
