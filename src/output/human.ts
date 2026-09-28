import { color, type ColorOptions, type Tone } from "./terminal.js";

/** Shorten a public base58 address for labels where the full value is nearby. */
export function shortenAddress(value: string, size = 4): string {
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}

/** Render a visually distinct section title without requiring color support. */
export function sectionTitle(value: string): string {
  return color(value, "heading");
}

/** Mark real-fund networks clearly while retaining an explicit text label. */
export function networkLabel(cluster: string): string {
  return cluster === "mainnet"
    ? color("MAINNET · REAL FUNDS", "warning")
    : color(cluster.toUpperCase(), "info");
}

/** A shared visual frame for transaction previews before user confirmation. */
export function actionPreview(
  title: string,
  rows: readonly (readonly [label: string, value: string, tone?: Tone])[],
): string {
  return `${sectionTitle(title)}\n${keyValueRows(rows)}`;
}

/** Render label/value pairs with a consistent, scan-friendly alignment. */
export function keyValueRows(
  rows: readonly (readonly [label: string, value: string, tone?: Tone])[],
  options: ColorOptions = {},
): string {
  if (!rows.length) return "";
  const labelWidth = Math.max(...rows.map(([label]) => displayWidth(label)));
  return rows
    .map(([label, value, tone]) => {
      const padding = " ".repeat(labelWidth - displayWidth(label));
      const styledLabel = color(label, "muted", options);
      const styledValue = tone ? color(value, tone, options) : value;
      return `${styledLabel}${padding}: ${styledValue}`;
    })
    .join("\n");
}

export interface TableOptions {
  /** Available printable columns; defaults to the current terminal width. */
  width?: number;
  /** Override color detection, primarily for output tests. */
  color?: boolean;
}

/**
 * Render an aligned table when it fits, otherwise switch to labeled rows.
 * The compact form preserves full addresses and other values rather than
 * clipping data that a user may need to copy into a follow-up command.
 */
export function table(
  rows: readonly (readonly string[])[],
  headers?: readonly string[],
  options: TableOptions = {},
): string {
  const all = headers ? [headers, ...rows] : rows;
  if (!all.length) return "";

  const columnCount = Math.max(...all.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...all.map((row) => displayWidth(row[index] ?? ""))),
  );
  const available = options.width ?? terminalWidth();
  const required =
    widths.reduce((total, width) => total + width, 0) +
    Math.max(0, widths.length - 1) * 2;
  const colorOptions = { enabled: options.color };

  if (headers && required > available) {
    return rows
      .map((row) =>
        headers
          .map((header, index) => {
            const value = row[index] ?? "";
            return `${color(header, "muted", colorOptions)}: ${value}`;
          })
          .join("\n"),
      )
      .join("\n\n");
  }

  const formatRow = (row: readonly string[]) =>
    Array.from({ length: columnCount }, (_, index) => {
      const cell = row[index] ?? "";
      return (
        cell +
        " ".repeat(Math.max(0, (widths[index] ?? 0) - displayWidth(cell)))
      );
    })
      .join("  ")
      .trimEnd();

  const output: string[] = [];
  if (headers) {
    output.push(color(formatRow(headers), "emphasis", colorOptions));
    output.push(
      color(
        widths.map((width) => "-".repeat(width)).join("  "),
        "muted",
        colorOptions,
      ),
    );
  }
  output.push(...rows.map(formatRow));
  return output.join("\n");
}

/** Strip ANSI controls and count terminal cells (including common wide glyphs). */
export function displayWidth(value: string): number {
  const plain = value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  let width = 0;
  for (const character of plain) {
    const point = character.codePointAt(0)!;
    if (/\p{Mark}/u.test(character) || point === 0x200d) continue;
    width += isWide(point) ? 2 : 1;
  }
  return width;
}

function terminalWidth(): number {
  const configured = Number(process.env.COLUMNS);
  return process.stdout.columns ?? (configured > 0 ? configured : 100);
}

function isWide(point: number): boolean {
  return (
    point >= 0x1100 &&
    (point <= 0x115f ||
      point === 0x2329 ||
      point === 0x232a ||
      (point >= 0x2e80 && point <= 0xa4cf && point !== 0x303f) ||
      (point >= 0xac00 && point <= 0xd7a3) ||
      (point >= 0xf900 && point <= 0xfaff) ||
      (point >= 0xfe10 && point <= 0xfe19) ||
      (point >= 0xfe30 && point <= 0xfe6f) ||
      (point >= 0xff00 && point <= 0xff60) ||
      (point >= 0xffe0 && point <= 0xffe6) ||
      (point >= 0x1f300 && point <= 0x1faff) ||
      (point >= 0x20000 && point <= 0x3fffd))
  );
}
