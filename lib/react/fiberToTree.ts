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

export interface NodeBounds {
  /** Document-space x (already includes scrollX at capture time) */
  x: number;
  /** Document-space y (already includes scrollY at capture time) */
  y: number;
  w: number;
  h: number;
}

export interface ComponentNode {
  id: string;
  name: string;
  kind: FiberKind;
  key?: string;
  childrenCount: number;
  children: ComponentNode[];
  /** Bounding box of the first host descendant in document coordinates */
  bounds?: NodeBounds;
}
