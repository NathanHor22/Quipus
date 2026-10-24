import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = realpathSync(process.cwd());

/**
 * Bundles a real Route Handler with selected `@/` modules replaced by inline mocks,
 * so tests exercise production route code without Next's server-only runtime.
 * Each mock source is prefixed with `prelude`, typically a shared-state lookup.
 */
export async function loadRoute<T>(
  entry: string,
  mocks: Record<string, string>,
  prelude = "",
): Promise<{ module: T; cleanup(): void }> {
  const folder = mkdtempSync(path.join(root, ".tmp-route-harness-"));
  const cleanup = () => {
    const resolved = realpathSync(folder);
    assert.ok(resolved.startsWith(root + path.sep) && path.basename(resolved).startsWith(".tmp-route-harness-"));
    rmSync(resolved, { recursive: true, force: true });
  };
  try {
    const result = await build({
      entryPoints: [path.join(root, entry)],
      bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      plugins: [{
        name: "route-harness-mocks",
        setup(builder) {
          builder.onResolve({ filter: /^@\// }, args => Object.hasOwn(mocks, args.path)
            ? { path: args.path, namespace: "mock" }
            : { path: path.join(root, args.path.slice(2) + ".ts") });
          // A mock keyed by its `@/` alias also replaces relative imports of the same module.
          builder.onResolve({ filter: /^\.\.?\// }, args => {
            if (args.namespace !== "file") return undefined;
            const alias = "@/" + path.relative(root, path.join(args.resolveDir, args.path)).split(path.sep).join("/");
            return Object.hasOwn(mocks, alias) ? { path: alias, namespace: "mock" } : undefined;
          });
          builder.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: prelude + mocks[args.path], loader: "js" }));
        },
      }],
    });
    const output = path.join(folder, "route.cjs");
    writeFileSync(output, result.outputFiles[0].contents);
    const load = createRequire(path.join(root, "package.json"));
    return { module: load(output) as T, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
