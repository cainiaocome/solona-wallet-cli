import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readSecret } from "../../src/shell/prompt.js";

describe("secret input", () => {
  it("refuses to read a passphrase from piped input", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    await expect(readSecret("Passphrase: ", { input, output })).rejects.toThrow(
      /interactive terminal/,
    );
    input.destroy();
    output.destroy();
  });
});
