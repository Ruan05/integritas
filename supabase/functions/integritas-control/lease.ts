export function normalizeLeaseCommand(data: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(data) ? (data[0] ?? null) : data;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;

  const record = candidate as Record<string, unknown>;
  if (record.id == null && Object.values(record).every((value) => value == null)) {
    return null;
  }

  return record;
}
