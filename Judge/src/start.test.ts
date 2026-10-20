import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("startup enforces no swap without writing unsupported host root limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "go-judge-start-"));
  try {
    const swaps = join(directory, "swaps");
    const ceiling = join(directory, "memory.swap.max");
    const script = (await readFile(new URL("../runtime/start.sh", import.meta.url), "utf8"))
      .replaceAll("/proc/swaps", swaps)
      .replaceAll("/sys/fs/cgroup/memory.swap.max", ceiling)
      .replace("/opt/go-judge", "true");
    await writeFile(swaps, "Filename Type Size Used Priority\n");
    await writeFile(ceiling, "max\n");
    assert.equal(spawnSync("sh", ["-c", script]).status, 0);
    assert.equal(await readFile(ceiling, "utf8"), "max\n", "host without swap needs no write");
    await writeFile(swaps, "Filename Type Size Used Priority\n/swap file 1024 0 -2\n");
    assert.equal(spawnSync("sh", ["-c", script]).status, 0);
    assert.equal(await readFile(ceiling, "utf8"), "0\n");
    await rm(ceiling);
    assert.notEqual(spawnSync("sh", ["-c", script]).status, 0, "v1 with active host swap is unsafe");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
