let debugMode = false;

export function setDebugMode(flag: boolean): void {
  debugMode = flag;
}

export function isDebugMode(): boolean {
  return debugMode;
}

export function debugDump(label: string, data: unknown): void {
  if (!debugMode) return;
  process.stderr.write(`[DEBUG] ${label}: ${JSON.stringify(data, null, 2)}\n`);
}
