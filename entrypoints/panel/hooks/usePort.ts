import { useEffect, useRef } from 'react';
import type { PanelToBg, BgToPanel } from '@/lib/bridge/protocol';

export interface Port {
  post(msg: PanelToBg): void;
}

export function usePort(onMessage: (msg: BgToPanel) => void): Port {
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const connect = () => {
      const port = chrome.runtime.connect({ name: 'panel' });
      portRef.current = port;
      port.onMessage.addListener((m: BgToPanel) => handlerRef.current(m));
      port.onDisconnect.addListener(() => {
        portRef.current = null;
        // Try to reconnect once the SW comes back up
        setTimeout(connect, 500);
      });
      try {
        port.postMessage({ type: 'panel.hello', tabId: chrome.devtools.inspectedWindow.tabId });
      } catch {
        /* ignore */
      }
    };
    connect();
    return () => {
      portRef.current?.disconnect();
      portRef.current = null;
    };
  }, []);

  return {
    post(msg) {
      portRef.current?.postMessage(msg);
    },
  };
}
