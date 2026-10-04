// LuckyTri Plugin API v1. A later API can be added beside this one;
// v1 stays available through the 1.x line.

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  pluginApi: "1.0";
  luckytri?: string;
  description?: string;
  author?: string;
  license?: string;
  entry?: string;
  permissions?: string[];
  network?: string[];
  settings?: PluginSetting[];
  contributes?: PluginContributes;
}

export interface PluginSetting {
  key: string;
  type:
    "text" | "secret" | "number" | "boolean" | "select" | "textarea" | "urls";
  label: string;
  required?: boolean;
  default?: unknown;
  allowNetwork?: boolean;
}

export interface PluginContributes {
  senses?: string[];
  channels?: {
    type: string;
    label?: string;
    capabilities?: Record<string, boolean>;
  }[];
  activities?: {
    kind: string;
    label?: string;
    describe?: string;
    keywords?: string;
    minutes?: number;
    energy?: boolean;
  }[];
  actions?: {
    name: string;
    label?: string;
    describe?: string;
    risk?: "low" | "high";
    confirm?: "none" | "owner";
    where?: "private" | "any";
    dailyLimit?: number;
  }[];
  perceive?: string[];
  ui?: { page?: boolean };
}

export interface PluginContext {
  plugin: { id: string; version: string; dataDir: string };
  api: { version: "1.0"; has(feature: string): boolean };
  now(): Promise<number>;
  log: {
    info(...parts: unknown[]): Promise<void>;
    warn(...parts: unknown[]): Promise<void>;
    error(...parts: unknown[]): Promise<void>;
  };
  settings: {
    get(): Promise<Record<string, unknown>>;
    onChange(fn: () => void): void;
  };
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
  };
  net: { fetch(url: string, init?: RequestInit): Promise<Response> };
  mind: {
    state(): Promise<Record<string, unknown>>;
    observe(input: {
      summary: string;
      detail?: string;
      discretion?: "open" | "private";
    }): Promise<{ ref?: string; rejected?: string }>;
    on(event: string, fn: (payload: unknown) => void): void;
  };
  senses: {
    set(
      key: string,
      sense: {
        text: string;
        discretion?: "open" | "private";
        ttlMinutes?: number;
      },
    ): Promise<void>;
    clear(key?: string): Promise<void>;
  };
  knowledge: {
    offer(doc: {
      title: string;
      text: string;
      url?: string;
    }): Promise<{ id: string }>;
  };
  activities: {
    handle(
      kind: string,
      prepare: (input: unknown) => Promise<unknown>,
    ): Promise<void>;
    setAvailable(kind: string, reason?: string): Promise<void>;
  };
  actions: {
    handle(
      name: string,
      run: (input: unknown) => Promise<unknown>,
    ): Promise<void>;
  };
  perceive: {
    handle(
      type: string,
      run: (input: unknown) => Promise<{ text?: string }>,
    ): Promise<void>;
  };
  channel: {
    provide(type: string, impl: Record<string, unknown>): Promise<void>;
    receive(type: string, message: Record<string, unknown>): Promise<void>;
    status(type: string, status: { online?: boolean }): Promise<void>;
    reachable(type: string, sessionKey: string, ok: boolean): Promise<void>;
  };
  models: { call(req: { system: string; input: unknown }): Promise<unknown> };
  http: {
    route(
      method: string,
      path: string,
      handler: (input: unknown) => Promise<unknown>,
    ): Promise<void>;
    hook(
      method: string,
      path: string,
      handler: (input: unknown) => Promise<unknown>,
    ): Promise<void>;
  };
  status: {
    set(status: {
      text: string;
      tone?: "ok" | "warn" | "error";
    }): Promise<void>;
  };
  notify(notice: { title: string; text: string }): Promise<void>;
}

export interface LuckyTriPlugin {
  activate(ctx: PluginContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
