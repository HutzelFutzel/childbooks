/**
 * CSV export for the Analysis tables.
 *
 * Every analysis eventually gets pulled into a spreadsheet for a question the
 * dashboard doesn't answer; exporting from the rendered rows means the export
 * always matches what the admin is looking at, filters included.
 */

type Cell = string | number | boolean | null | undefined;

/** RFC-4180 escaping: quote when the value contains a delimiter or a quote. */
function escapeCell(value: Cell): string {
  if (value == null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, Cell>[]): string {
  if (rows.length === 0) return "";
  // Union of keys across rows, so a sparse row can't shift later columns.
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => escapeCell(row[h])).join(","));
  return lines.join("\r\n");
}

/** Trigger a browser download of `rows` as `{name}-{YYYY-MM-DD}.csv`. */
export function downloadCsv(name: string, rows: Record<string, Cell>[]): void {
  const csv = toCsv(rows);
  if (!csv) return;
  // The BOM makes Excel read UTF-8 correctly instead of mangling accents.
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
