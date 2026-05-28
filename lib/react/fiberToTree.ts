export type FiberKind =
  | 'function'
  | 'class'
  | 'memo'
  | 'forwardRef'
  | 'lazy'
  | 'provider'
  | 'consumer'
  | 'fragment'
  | 'host'
  | 'text'
  | 'suspense'
  | 'portal'
  | 'root'
  | 'unknown';

export interface ComponentNode {
  id: string;
  name: string;
  kind: FiberKind;
  key?: string;
  childrenCount: number;
  children: ComponentNode[];
}
