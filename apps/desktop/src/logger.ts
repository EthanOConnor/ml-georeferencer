// Simple in-memory debug logger with download support
export type LogEntry = {
  seq: number;
  ts: string; // ISO timestamp
  topic: string;
  data?: any;
};

let enabled = false;
let seq = 0;
const logs: LogEntry[] = [];

export function setLoggingEnabled(on: boolean) {
  enabled = on;
}

export function isLoggingEnabled() {
  return enabled;
}

export function log(topic: string, data?: any) {
  if (!enabled) return;
  const entry: LogEntry = {
    seq: ++seq,
    ts: new Date().toISOString(),
    topic,
    data,
  };
  logs.push(entry);
  // Also print to console for immediate inspection
  try {
    // Avoid crashing on circular data
    const safe = data && typeof data === 'object' ? JSON.parse(JSON.stringify(data)) : data;
    // eslint-disable-next-line no-console
    console.debug(`[DBG ${entry.seq}] ${entry.ts} ${topic}`, safe);
  } catch {
    // eslint-disable-next-line no-console
    console.debug(`[DBG ${entry.seq}] ${entry.ts} ${topic}`, data);
  }
}

export function getLogs(): LogEntry[] {
  return logs.slice();
}

export function clearLogs() {
  logs.length = 0;
}

export function downloadLogs(filename = `ml-georeferencer-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`) {
  const blob = new Blob([JSON.stringify({ meta: { created: new Date().toISOString() }, logs }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
