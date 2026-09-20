export function shortenAddress(value: string, size = 4): string {
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}

export function table(
  rows: readonly (readonly string[])[],
  headers?: readonly string[],
): string {
  const all = headers ? [headers, ...rows] : rows;
  if (!all.length) return "";
  const widths = all[0]!.map((_, index) =>
    Math.max(...all.map((row) => (row[index] ?? "").length)),
  );
  const formatRow = (row: readonly string[]) =>
    row
      .map((cell, index) => (cell ?? "").padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  const output = headers
    ? [formatRow(headers), formatRow(widths.map((width) => "-".repeat(width)))]
    : [];
  output.push(...rows.map(formatRow));
  return output.join("\n");
}
