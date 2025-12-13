declare module "redis" {
  export interface RedisClientType {
    connect(): Promise<void>;
    on(event: string, listener: (...args: unknown[]) => void): this;
    set(
      key: string,
      value: string,
      options?: Record<string, unknown>,
    ): Promise<string | null>;
    quit(): Promise<void>;
  }

  export function createClient(options: {
    url: string;
    socket?: { reconnectStrategy?: () => number | Error };
  }): RedisClientType;
}
