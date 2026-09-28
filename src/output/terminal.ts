/** Semantic terminal colors shared by command output and interactive prompts. */
export type Tone =
  | "heading"
  | "emphasis"
  | "muted"
  | "success"
  | "info"
  | "warning"
  | "error";

export type TerminalStream = "stdout" | "stderr";

export interface ColorOptions {
  /** Override terminal detection in tests or for a deliberately styled view. */
  enabled?: boolean;
  stream?: TerminalStream;
}

const ANSI: Record<Tone, readonly [open: string, close: string]> = {
  heading: ["\u001b[1;36m", "\u001b[0m"],
  emphasis: ["\u001b[1m", "\u001b[0m"],
  muted: ["\u001b[2m", "\u001b[0m"],
  success: ["\u001b[1;32m", "\u001b[0m"],
  info: ["\u001b[36m", "\u001b[0m"],
  warning: ["\u001b[1;33m", "\u001b[0m"],
  error: ["\u001b[1;31m", "\u001b[0m"],
};

/**
 * Be conservative: redirected output and dumb terminals stay plain, and the
 * standard NO_COLOR opt-out always wins. Meaningful text never depends on it.
 */
export function terminalColorEnabled(
  stream: TerminalStream = "stdout",
  env: NodeJS.ProcessEnv = process.env,
  isTTY = stream === "stdout"
    ? Boolean(process.stdout.isTTY)
    : Boolean(process.stderr.isTTY),
): boolean {
  if (!isTTY || env.NO_COLOR !== undefined || env.TERM === "dumb") return false;
  return true;
}

/** Wrap text in one ANSI style only when the destination supports color. */
export function color(
  value: string,
  tone: Tone,
  options: ColorOptions = {},
): string {
  const stream = options.stream ?? "stdout";
  const enabled = options.enabled ?? terminalColorEnabled(stream);
  if (!enabled || !value) return value;
  const [open, close] = ANSI[tone];
  return `${open}${value}${close}`;
}

/**
 * Mark escape bytes as non-printing for Node's readline cursor calculations.
 * The markers themselves are consumed by readline and never appear on screen.
 */
export function readlineColor(
  value: string,
  tone: Tone,
  enabled = terminalColorEnabled("stdout"),
): string {
  const rendered = color(value, tone, { enabled });
  return rendered === value ? value : `\u0001${rendered}\u0002`;
}
