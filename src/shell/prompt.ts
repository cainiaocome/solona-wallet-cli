import readline from "node:readline";
import { readSync } from "node:fs";

export interface PromptIO {
  input: NodeJS.ReadableStream & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  output: NodeJS.WritableStream;
}

export function createPromptIO(): PromptIO {
  return { input: process.stdin, output: process.stderr };
}

export async function readLine(
  question: string,
  io = createPromptIO(),
): Promise<string> {
  if (!io.input.isTTY && "fd" in io.input && typeof io.input.fd === "number") {
    io.output.write(question);
    const bytes = Buffer.alloc(1);
    let answer = "";
    while (true) {
      const count = readSync(io.input.fd, bytes, 0, 1, null);
      if (!count || bytes[0] === 10 || bytes[0] === 13) break;
      answer += String.fromCharCode(bytes[0]!);
    }
    io.output.write("\n");
    return answer;
  }
  const rl = readline.createInterface({
    input: io.input,
    output: io.output,
    terminal: Boolean(io.input.isTTY),
  });
  try {
    return await new Promise<string>((resolve) =>
      rl.question(question, (answer) => resolve(answer)),
    );
  } finally {
    rl.close();
  }
}

export async function readSecret(
  question: string,
  io = createPromptIO(),
): Promise<string> {
  const input = io.input;
  const output = io.output;
  if (!input.isTTY || !input.setRawMode) return readLine(question, io);
  output.write(question);
  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString();
      for (const char of text) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Input cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          output.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
    };
    input.setRawMode!(true);
    input.resume();
    input.on("data", onData);
  });
}

export async function confirm(
  question: string,
  defaultNo = true,
): Promise<boolean> {
  const answer = (await readLine(`${question} [y/N] `)).trim().toLowerCase();
  if (!answer) return !defaultNo;
  return answer === "y" || answer === "yes";
}
