export function dateTimeColumn(comment: string) {
  return {
    type: 'datetime' as const,
    precision: 6,
    comment,
  };
}

export function textColumn(comment: string) {
  return {
    type: 'text' as const,
    comment,
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
  };
}

export function stringColumn(length: number, comment: string, unique = false) {
  return {
    type: 'varchar' as const,
    length,
    comment,
    ...(unique ? { unique: true as const } : {}),
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
  };
}
