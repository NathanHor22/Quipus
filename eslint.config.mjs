import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
    "out/**",
    "output/**",
    "tmp/**",
    ".tmp-*/**",
    ".tools/**",
    ".vercel/**",
    "hardware/**",
    "next-env.d.ts",
  ]),
]);
