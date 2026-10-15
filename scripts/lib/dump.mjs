import fs from 'node:fs';
import zlib from 'node:zlib';

/** Unescape a PostgreSQL text-format COPY field. */
function unescapeField(value) {
  if (value === '\\N') return null;
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch !== '\\') { out += ch; continue; }
    const next = value[++i];
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === 'v') out += '\v';
    else if (next === '0') out += '\0';
    else if (next === '\\') out += '\\';
    else if (next >= '0' && next <= '7') {
      let oct = next;
      while (oct.length < 3 && value[i + 1] >= '0' && value[i + 1] <= '7') oct += value[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += next;
  }
  return out;
}

/** Parse COPY blocks out of a plain PostgreSQL dump. Returns Map<table, rows[]>. */
export function parseDump(sqlPath) {
  const raw = sqlPath.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(sqlPath)) : fs.readFileSync(sqlPath);
  const text = raw.toString('utf8');
  const lines = text.split('\n');
  const tables = new Map();
  let current = null;
  for (const line of lines) {
    if (current) {
      if (line === '\\.') { current = null; continue; }
      if (line === '') continue;
      const fields = line.split('\t').map(unescapeField);
      const row = {};
      current.columns.forEach((col, idx) => { row[col] = fields[idx]; });
      current.rows.push(row);
      continue;
    }
    const m = /^COPY (?:public\.)?([A-Za-z_0-9]+)\.([A-Za-z_0-9]+) \((.*)\) FROM stdin;/.exec(line);
    if (m) {
      const fullName = `${m[1]}.${m[2]}`;
      const entry = { schema: m[1], table: m[2], columns: m[3].split(',').map((c) => c.trim()), rows: [] };
      tables.set(fullName, entry);
      if (entry.schema === 'public') tables.set(entry.table, entry);
      current = entry;
    }
  }
  return tables;
}

export function parseJsonColumn(value) {
  if (value == null || value === '') return null;
  try { return JSON.parse(value); } catch { return value; }
}
