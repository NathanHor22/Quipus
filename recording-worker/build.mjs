import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ["recording-worker/src/server.ts"],
  outfile: "recording-worker/dist/server.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  sourcemap: true,
  packages: "bundle",
  alias: { "@/lib/supabase/server": path.join(root, "recording-worker/src/request-context.ts") },
  plugins: [
    {
      name: "server-boundary",
      setup(builder) {
        // The worker is a server process. Keep Next's marker, not its request runtime.
        builder.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "server-marker",
        }));
        builder.onLoad({ filter: /.*/, namespace: "server-marker" }, () => ({
          contents: "",
          loader: "js",
        }));
        builder.onResolve({ filter: /^(next|react)(\/|$)/ }, (args) => {
          throw new Error(`Request/UI dependency entered the worker: ${args.path}`);
        });
      },
    },
  ],
});
