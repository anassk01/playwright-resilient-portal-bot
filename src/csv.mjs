export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, '');
  if (!source.length) return [];

  const field = /("(?:[^"]|"")*"|[^",\r\n]*)(,|\r\n|\n|$)/y;
  const rows = [];
  let row = [];

  for (;;) {
    const offset = field.lastIndex;
    const match = field.exec(source);
    if (!match) throw new SyntaxError('Invalid CSV field at character ' + (offset + 1));
    const [, value, separator] = match;
    row.push(value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value);

    if (separator === ',') continue;
    rows.push(row);
    if (field.lastIndex === source.length) return rows;
    row = [];
  }
}

export function serializeCsv(rows) {
  if (!rows.length) return '';
  const lines = rows.map((row) => row.map((value) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }).join(','));
  return lines.join('\r\n') + '\r\n';
}
