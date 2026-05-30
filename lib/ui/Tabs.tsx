import type { ReactNode } from 'react';

/**
 * Generic horizontal tab strip + body slot. Stateless — the parent
 * tracks which id is active. Used by FileDetail (Source + analyses)
 * and ModuleAnalysis (Summary + analyses) to expose more vertical
 * real-estate to whichever pane the user is looking at.
 *
 * Design rules:
 *   - Tabs render in the order given.
 *   - A `badge` (streaming / done / error) shows a small dot next to
 *     the label so the user can spot in-flight or failed analyses
 *     without switching to them.
 *   - `closable` tabs get a × button. We don't render `×` for the
 *     "main" tab (Source / Summary) so it can never be removed.
 *   - The body is a render-prop so the parent owns its content; we
 *     don't memoise across tab switches, but the parent's state
 *     (streaming text, fetched content) survives intact because
 *     it's stored above this component.
 */

export type TabBadge = 'streaming' | 'done' | 'error';

export interface TabItem {
  id: string;
  label: string;
  badge?: TabBadge;
  closable?: boolean;
  /** Optional emoji/icon glyph before the label. */
  icon?: string;
}

interface Props {
  tabs: TabItem[];
  activeId: string;
  onSelect(id: string): void;
  onClose?(id: string): void;
  children: ReactNode;
}

export function Tabs({ tabs, activeId, onSelect, onClose, children }: Props) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 overflow-x-auto border-b border-panel-border bg-panel-surface text-[11px]">
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={isActive}
              className={
                'group flex shrink-0 cursor-pointer items-center gap-1 border-b-2 px-3 py-1.5 ' +
                (isActive
                  ? 'border-panel-accent text-white'
                  : 'border-transparent text-panel-muted hover:text-white')
              }
              onClick={() => onSelect(t.id)}
            >
              {t.icon && <span>{t.icon}</span>}
              <span className="truncate">{t.label}</span>
              <BadgeDot badge={t.badge} />
              {t.closable && onClose && (
                <button
                  type="button"
                  className="ml-1 hidden text-panel-muted hover:text-red-300 group-hover:inline-block"
                  title="Close tab"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function BadgeDot({ badge }: { badge?: TabBadge }) {
  if (!badge) return null;
  const cls =
    badge === 'streaming'
      ? 'bg-sky-400 animate-pulse'
      : badge === 'error'
        ? 'bg-red-400'
        : 'bg-emerald-400';
  return <span className={'ml-0.5 inline-block h-1.5 w-1.5 rounded-full ' + cls} />;
}
