import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("sol-wallet launcher output", () => {
  it("keeps Docker pull progress off stdout for JSON commands", async () => {
    const { directory, dockerDirectory } = await setupDockerStub();
    const result = spawnSync(
      "bash",
      ["scripts/sol-wallet", "-c", "status --json"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dockerDirectory}:${process.env.PATH ?? ""}`,
          SOL_WALLET_CONFIG_DIR: path.join(directory, "config"),
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('{"ok":true}\n');
    expect(result.stderr).toContain("master: Pulling latest image");
  });

  it("does not start the container after a failed pull", async () => {
    const { directory, dockerDirectory } = await setupDockerStub("exit 19");
    const result = spawnSync(
      "bash",
      ["scripts/sol-wallet", "-c", "status --json"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dockerDirectory}:${process.env.PATH ?? ""}`,
          SOL_WALLET_CONFIG_DIR: path.join(directory, "config"),
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("master: Pulling latest image");
    expect(result.stderr).not.toContain("container started");
  });
});

async function setupDockerStub(failure = "") {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "sol-wallet-wrapper-"),
  );
  temporaryDirectories.push(directory);
  const dockerDirectory = path.join(directory, "bin");
  await mkdir(dockerDirectory);
  const docker = path.join(dockerDirectory, "docker");
  await writeFile(
    docker,
    `#!/bin/sh
if [ "$1" = pull ]; then
  echo "master: Pulling latest image"
  ${failure || "exit 0"}
fi
echo "container started" >&2
echo '{"ok":true}'
`,
    { mode: 0o700 },
  );
  await chmod(docker, 0o700);
  return { directory, dockerDirectory };
}
