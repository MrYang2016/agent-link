let lastCreatedMicros = 0n;

export function nextCreatedAt(): string {
  const now = BigInt(Date.now()) * 1000n;
  const value = now > lastCreatedMicros ? now : lastCreatedMicros + 1n;
  lastCreatedMicros = value;
  const epochMs = value / 1000n;
  const extra = Number(value % 1000n);
  const iso = new Date(Number(epochMs)).toISOString();
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.(\d{3})Z$/.exec(iso);
  if (!match) return iso;
  return `${match[1]} ${match[2]}.${match[3]}${String(extra).padStart(3, '0')}`;
}

export function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  if (value.includes('T') && value.endsWith('Z')) return value;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?/.exec(value);
  if (!match) return value;
  const fraction = (match[3] || '0').padEnd(3, '0').slice(0, 3);
  return `${match[1]}T${match[2]}.${fraction}Z`;
}
