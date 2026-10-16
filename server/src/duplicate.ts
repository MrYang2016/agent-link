export function isDuplicateEntry(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: string; driverError?: { code?: string } };
  return record.code === 'ER_DUP_ENTRY' || record.driverError?.code === 'ER_DUP_ENTRY';
}
