import { stringifyJson } from "./json.js";
import { redact, type AppError } from "../errors/errors.js";

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

export class Output {
  constructor(private readonly options: OutputOptions) {}

  get json(): boolean {
    return this.options.json;
  }

  get verbose(): boolean {
    return this.options.verbose;
  }

  print(value: unknown, human?: string): void {
    if (this.options.json) process.stdout.write(`${stringifyJson(value)}\n`);
    else if (human !== undefined) process.stdout.write(`${human}\n`);
    else if (typeof value === "string") process.stdout.write(`${value}\n`);
    else process.stdout.write(`${stringifyJson(value)}\n`);
  }

  /** Show transaction details before consent while keeping JSON stdout parseable. */
  preflight(value: unknown, human: string): void {
    if (this.options.json) process.stderr.write(`${human}\n`);
    else this.print(value, human);
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
      process.stderr.write(`Error: ${error.message}\n`);
      if (this.options.verbose && error.details !== undefined)
        process.stderr.write(`Details: ${stringifyJson(error.details)}\n`);
    }
  }
}
