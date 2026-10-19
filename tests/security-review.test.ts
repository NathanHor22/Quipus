import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildSecurityReviewInput,
  redactSecurityText,
  validateSecurityAssessment,
} from "../lib/security-review";

const scanner = {
  dependencies: [
    {
      package: "example-package",
      severity: "high",
      direct: true,
      fixAvailable: true,
      advisoryIds: [12345],
    },
  ],
  credentials: [{ path: "lib/config.ts", rule: "openai-key" }],
  checks: [{ name: "dependency-audit", state: "failed" }],
};

test("security review accepts only scanner metadata and rejects raw customer or credential fields", () => {
  const input = buildSecurityReviewInput(scanner);
  assert.equal(input.dependencies[0].ref, "dependency-1");
  assert.equal(input.credentials[0].ref, "credential-1");
  for (const key of ["transcript", "audio", "rawLogs", "token", "recordingUrl"])
    assert.throws(() => buildSecurityReviewInput({ ...scanner, [key]: "private meeting data" }));
  assert.throws(() =>
    buildSecurityReviewInput({
      ...scanner,
      dependencies: [{ ...scanner.dependencies[0], sourceCode: "secret implementation" }],
    }),
  );
});

test("redaction removes tokens, emails, signed URLs and untrusted file paths", () => {
  const token = "sk-proj-" + "x".repeat(60);
  const jwt = "eyJhbGciOiJIUzI1NiJ9" + ".payload.signature";
  const text = redactSecurityText(
    `${token} ${jwt} Bearer private-access-token owner@example.com https://storage.example/private.wav?token=secret ${"a".repeat(64)}`,
  );
  assert.equal(text.includes(token), false);
  assert.equal(text.includes("owner@example.com"), false);
  assert.equal(text.includes("storage.example"), false);
  assert.equal(text.includes("private-access-token"), false);
  assert.equal(text.includes(jwt), false);
  const input = buildSecurityReviewInput({
    ...scanner,
    credentials: [{ path: "recordings/customer-meeting.wav", rule: "tracked-environment-file" }],
  });
  assert.equal(input.credentials[0].path, "[REDACTED PATH]");
});

test("triage output is advisory-only, redacted and restricted to real scanner references", () => {
  const input = buildSecurityReviewInput(scanner);
  const finding = {
    severity: "high",
    category: "dependency",
    title: "Update dependency",
    rationale: "Published advisory",
    recommendedFix: "Prepare a dependency update for review.",
    tests: ["Run ownership regression tests."],
    sourceRefs: ["dependency-1"],
  };
  const result = validateSecurityAssessment(
    {
      summary: "Review owner@example.com",
      findings: [finding, { ...finding, sourceRefs: ["invented-vulnerability"] }],
    },
    input,
  );
  assert.equal(result.mode, "advisory-only");
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.findings.length, 1);
  assert.equal(result.summary.includes("owner@example.com"), false);
  assert.throws(() =>
    validateSecurityAssessment({ summary: "Unsafe", findings: [], execute: "deploy" }, input),
  );
});

test("optional triage refuses ordinary application credentials", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/security-review.mjs"], {
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      SECURITY_REVIEW_OPENAI_API_KEY: "",
      OPENAI_API_KEY: "production-key-must-not-be-used",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated SECURITY_REVIEW_OPENAI_API_KEY/);
  assert.equal(result.stderr.includes("production-key-must-not-be-used"), false);
});
