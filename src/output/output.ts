import { stringifyJson } from "./json.js";
import { redact, type AppError } from "../errors/errors.js";
import { color } from "./terminal.js";

/**
 * Output boundary shared by all commands.
 *
 * Human output is for people at a terminal; JSON output is for scripts. Keeping
 * the choice here prevents handlers from accidentally mixing logs with a JSON
 * document and keeps error output on stderr.
 */
export interface OutputOptions {
  json: boolean;
  verbose: boolean;
}

type OutputWallet = { id: string; alias: string; address: string };

export class Output {
  constructor(
    private readonly options: OutputOptions,
    private readonly getWallet?: () => OutputWallet | undefined,
    private readonly getCluster?: () => string,
  ) {}

  get json(): boolean {
    return this.options.json;
  }

  get verbose(): boolean {
    return this.options.verbose;
  }

  print(value: unknown, human?: string): void {
    const decorated = this.decorate(value);
    const identity = this.getWallet?.();
    const walletLine = identity
      ? new RegExp(
          `(^|\\n)([ \\t]*Wallet[ \\t]*:[ \\t]*)${escapeRegExp(identity.address)}(?=[ \\t]*(?:\\n|$))`,
          "g",
        )
      : null;
    const renderedHuman =
      identity && human && walletLine
        ? human.replace(
            walletLine,
            `$1$2${identity.alias} (${identity.address})`,
          )
        : human;
    const hasWalletIdentity = renderedHuman
      ?.split("\n")
      .some((line) => /^\s*(?:Selected )?Wallet\s*:/.test(line));
    const prefix =
      identity && !hasWalletIdentity
        ? `Wallet: ${identity.alias} (${identity.address})\n`
        : "";
    if (this.options.json)
      process.stdout.write(`${stringifyJson(decorated)}\n`);
    else if (renderedHuman !== undefined)
      process.stdout.write(`${prefix}${renderedHuman}\n`);
    else if (typeof value === "string") process.stdout.write(`${value}\n`);
    else process.stdout.write(`${stringifyJson(decorated)}\n`);
  }

  /** Show transaction details before consent while keeping JSON stdout parseable. */
  preflight(value: unknown, human: string): void {
    if (this.options.json)
      process.stderr.write(`${stringifyJson(this.decorate(value))}\n`);
    else this.print(value, human);
  }

  private decorate(value: unknown): unknown {
    const wallet = this.getWallet?.();
    if (!wallet || !value || typeof value !== "object" || Array.isArray(value))
      return value;
    const transformed = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === "wallet" && typeof child === "string"
          ? wallet
          : this.decorateNested(child, wallet),
      ]),
    );
    return { ...transformed, wallet, cluster: this.getCluster?.() };
  }

  private decorateNested(value: unknown, wallet: OutputWallet): unknown {
    if (Array.isArray(value))
      return value.map((item) => this.decorateNested(item, wallet));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === "wallet" && typeof child === "string"
          ? wallet
          : this.decorateNested(child, wallet),
      ]),
    );
  }

  error(error: AppError): void {
    const payload = {
      ok: false,
      error: error.code,
      message: error.message,
      ...(error.details ? { details: redact(error.details) } : {}),
    };
    if (this.options.json) process.stderr.write(`${stringifyJson(payload)}\n`);
    else {
      process.stderr.write(
        `${color("Error", "error", { stream: "stderr" })}: ${error.message}\n`,
      );
      if (this.options.verbose && error.details !== undefined)
        process.stderr.write(
          `${color("Details", "muted", { stream: "stderr" })}: ${stringifyJson(error.details)}\n`,
        );
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
