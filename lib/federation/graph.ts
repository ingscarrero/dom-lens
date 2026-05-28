export type FederationKind =
  | 'webpack5'
  | 'vite-plugin-federation'
  | 'native-federation'
  | 'import-map'
  | 'unknown';

export interface Remote {
  name: string;
  entry: string;
  exposes: string[];
  loaded: boolean;
  shareScope?: string;
}

export interface FederationGraph {
  kind: FederationKind;
  detected: boolean;
  host: {
    name: string;
    shared: string[];
  };
  remotes: Remote[];
  signals: string[];
}
