export function createSessionId(): string {
  return crypto.randomUUID();
}
