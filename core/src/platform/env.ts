// Configuration comes from the environment / secrets manager only (SEC-04). No credentials in source.
export interface Env {
  databaseUrl: string;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  nodeEnv: string;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return {
    databaseUrl,
    sessionIdleMinutes: Number(source.SESSION_IDLE_MINUTES ?? 15),
    sessionAbsoluteHours: Number(source.SESSION_ABSOLUTE_HOURS ?? 12),
    nodeEnv: source.NODE_ENV ?? 'development',
  };
}
