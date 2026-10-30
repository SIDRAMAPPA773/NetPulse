export const escapeCsvCell = (value) => {
  const text = value === null || value === undefined
    ? ''
    : value instanceof Date
      ? value.toISOString()
      : String(value);
  const safeText = typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

export const toCsv = (headers, rows) => [
  headers.map(escapeCsvCell).join(','),
  ...rows.map(row => row.map(escapeCsvCell).join(',')),
].join('\r\n');
