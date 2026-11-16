import { execFileSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { join } from "node:path";

export function checkoutProvenance() {
  // Container tests use a different HOME from checkout's temporary Git config.
  // Trust only this resolved checkout for these readonly subprocesses; never
  // change global configuration or substitute the PR head for the actual HEAD.
  const root = realpathSync(new URL("../../", import.meta.url));
  const marker = statSync(join(root, ".git"));
  if (!marker.isFile() && !marker.isDirectory()) throw new Error("Expected a Git checkout beside Front");
  const git = (...args: string[]) => execFileSync("git", ["-c", `safe.directory=${root}`, ...args], {
    cwd: root, encoding: "utf8",
  }).trim();
  return { sha: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"),
    trackedTreeClean: git("status", "--porcelain", "--untracked-files=no") === "" };
}
