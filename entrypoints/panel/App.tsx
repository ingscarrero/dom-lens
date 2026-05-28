import { useEffect } from 'react';
import { useStore, type Tab } from './store';
import { usePort } from './hooks/usePort';
import { useNetwork } from './hooks/useNetwork';
import { callDomLensCapture } from './hooks/useInspectedEval';
import { loadSettings, onSettingsChanged } from '@/lib/storage/settings';
import SnapshotTab from './tabs/SnapshotTab';
import ComponentsTab from './tabs/ComponentsTab';
import FederationTab from './tabs/FederationTab';
import AnalyzeTab from './tabs/AnalyzeTab';
import SettingsTab from './tabs/SettingsTab';
import type { BgToPanel } from '@/lib/bridge/protocol';

const TABS: { id: Tab; label: string }[] = [
  { id: 'snapshot', label: 'Snapshot' },
  { id: 'components', label: 'Components' },
  { id: 'federation', label: 'Federation' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'settings', label: 'Settings' },
];

export default function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const capturing = useStore((s) => s.capturing);
  const captureError = useStore((s) => s.captureError);
  const setCapturing = useStore((s) => s.setCapturing);
  const setSnapshot = useStore((s) => s.setSnapshot);
  const setCaptureError = useStore((s) => s.setCaptureError);
  const setSettings = useStore((s) => s.setSettings);
  const appendChatDelta = useStore((s) => s.appendChatDelta);
  const endChat = useStore((s) => s.endChat);
  const setTestConnection = useStore((s) => s.setTestConnection);
  const setChatRequestId = useStore((s) => s.setChatRequestId);

  useNetwork();

  const port = usePort((msg: BgToPanel) => {
    if (msg.type === 'capture.result') {
      setSnapshot(msg.snapshot);
      // clear network buffer after stamping snapshot
      useStore.getState().clearNetwork();
    } else if (msg.type === 'capture.error') {
      setCaptureError(msg.message);
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

  useEffect(() => {
    loadSettings().then(setSettings);
    return onSettingsChanged(setSettings);
  }, [setSettings]);

  const onCapture = async () => {
    setCapturing(true);
    const settings = useStore.getState().settings;
    const network = useStore.getState().network;
    const tabId = chrome.devtools.inspectedWindow.tabId;
    const result = await callDomLensCapture(settings.maxMarkdownChars);
    if (!result.ok) {
      setCaptureError(result.reason);
      return;
    }
    port.post({
      type: 'capture.finalize',
      tabId,
      partial: result.partial,
      network,
    });
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
          <span className="text-xs text-panel-muted">v0.1.0</span>
        </div>
        <div className="flex items-center gap-2">
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
        {tab === 'snapshot' && <SnapshotTab />}
        {tab === 'components' && <ComponentsTab />}
        {tab === 'federation' && <FederationTab />}
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
