import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, extname } from "node:path";

// Deliberately report paths and rule names, never matched secret material.
const rules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/u],
  ["github-token", /\b(?:ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{70,})\b/u],
  ["aws-access-key", /\bAKIA[A-Z0-9]{16}\b/u],
];
const binary = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".glb", ".bin", ".wav", ".mp4", ".pdf", ".zip", ".woff", ".woff2"]);
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const failures = [];
for (const path of tracked) {
  if (basename(path).startsWith(".env") && !path.endsWith(".example")) {
    failures.push([path, "tracked-environment-file"]); continue;
  }
  if (binary.has(extname(path).toLowerCase())) continue;
  let source;
  try { if (statSync(path).size > 2 * 1024 * 1024) continue; source = readFileSync(path, "utf8"); }
  catch { continue; } // Deleted tracked files are absent from the release.
  for (const [name, pattern] of rules) if (pattern.test(source)) failures.push([path, name]);
}
if (process.argv.includes("--json")) {
  process.stdout.write(JSON.stringify({ failures: failures.map(([path, rule]) => ({ path, rule })) }) + "\n");
} else {
  for (const [path, rule] of failures) process.stderr.write(`${path}: ${rule}\n`);
  if (!failures.length) process.stdout.write("No high-confidence tracked credential patterns found. This is not a complete secret audit.\n");
}
if (failures.length) process.exitCode = 1;
