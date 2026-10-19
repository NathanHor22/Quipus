import { z } from "zod";

const severity = z.enum(["info", "low", "moderate", "high", "critical"]);
const rule = z.enum([
  "private-key",
  "openai-key",
  "github-token",
  "aws-access-key",
  "tracked-environment-file",
]);
const inputSchema = z
  .object({
    dependencies: z
      .array(
        z
          .object({
            package: z
              .string()
              .min(1)
              .max(160)
              .regex(/^@?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?$/u),
            severity,
            direct: z.boolean(),
            fixAvailable: z.boolean(),
            advisoryIds: z.array(z.number().int().nonnegative()).max(20),
          })
          .strict(),
      )
      .max(200),
    credentials: z.array(z.object({ path: z.string().max(400), rule }).strict()).max(100),
    checks: z
      .array(
        z
          .object({
            name: z.enum(["dependency-audit", "tracked-secret-scan", "application-boundaries"]),
            state: z.enum(["passed", "failed", "unavailable"]),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();
export type SecurityScannerInput = z.infer<typeof inputSchema>;

/** Defense in depth on allowlisted scanner metadata; never send source/log bodies. */
export function redactSecurityText(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/gu,
      "[REDACTED TOKEN]",
    )
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED JWT]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/giu, "[REDACTED AUTH]")
    .replace(/https?:\/\/[^\s<>"']+/giu, "[REDACTED URL]")
    .replace(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, "[REDACTED EMAIL]")
    .replace(/\b[a-f0-9]{48,}\b/giu, "[REDACTED SECRET]");
}

export function buildSecurityReviewInput(value: unknown) {
  const input = inputSchema.parse(value);
  return {
    dependencies: input.dependencies.map((item, index) => ({
      ...item,
      ref: `dependency-${index + 1}`,
      package: redactSecurityText(item.package),
    })),
    credentials: input.credentials.map((item, index) => ({
      ref: `credential-${index + 1}`,
      rule: item.rule,
      path: /^(?:app|lib|components|tests|scripts|worker|recording-worker|hardware|supabase|\.github)\//u.test(
        item.path,
      )
        ? redactSecurityText(item.path).replace(/[\r\n]/gu, "")
        : "[REDACTED PATH]",
    })),
    checks: input.checks,
  };
}
export type SecurityReviewInput = ReturnType<typeof buildSecurityReviewInput>;
const assessmentSchema = z
  .object({
    summary: z.string().trim().min(1).max(800),
    findings: z
      .array(
        z
          .object({
            severity,
            category: z.enum(["dependency", "credential", "test_boundary", "configuration"]),
            title: z.string().trim().min(1).max(160),
            rationale: z.string().max(800),
            recommendedFix: z.string().max(1_000),
            tests: z.array(z.string().max(240)).max(5),
            sourceRefs: z.array(z.string().max(80)).min(1).max(10),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

/** Model output is a review artifact, never a command, patch or deployment. */
export function validateSecurityAssessment(value: unknown, input: SecurityReviewInput) {
  const result = assessmentSchema.parse(value);
  const refs = new Set([
    ...input.dependencies.map((item) => item.ref),
    ...input.credentials.map((item) => item.ref),
    ...input.checks.map((item) => item.name),
  ]);
  const findings = result.findings
    .filter((item) => item.sourceRefs.every((ref) => refs.has(ref)))
    .map((item) => ({
      ...item,
      title: redactSecurityText(item.title),
      rationale: redactSecurityText(item.rationale),
      recommendedFix: redactSecurityText(item.recommendedFix),
      tests: item.tests.map(redactSecurityText),
    }));
  return {
    mode: "advisory-only" as const,
    requiresHumanReview: true as const,
    summary: redactSecurityText(result.summary),
    findings,
  };
}

export const SECURITY_ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "severity",
          "category",
          "title",
          "rationale",
          "recommendedFix",
          "tests",
          "sourceRefs",
        ],
        properties: {
          severity: { type: "string", enum: ["info", "low", "moderate", "high", "critical"] },
          category: {
            type: "string",
            enum: ["dependency", "credential", "test_boundary", "configuration"],
          },
          title: { type: "string" },
          rationale: { type: "string" },
          recommendedFix: { type: "string" },
          tests: { type: "array", items: { type: "string" } },
          sourceRefs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
