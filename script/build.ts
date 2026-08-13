import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm } from "node:fs/promises";

// Everything is bundled into dist/index.cjs so the app has zero runtime
// npm dependencies (required for single-executable packaging). The vite dev
// server chain is dev-only (dead code in production builds) and stays external.
const devOnlyExternals = [
  "vite",
  "../vite.config",
  "@vitejs/plugin-react",
  "@tailwindcss/vite",
  "nanoid",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: devOnlyExternals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
