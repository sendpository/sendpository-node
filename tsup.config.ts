import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

export default defineConfig([
  {
  entry: ["src/index.ts"],
  // Both formats: ESM for modern bundlers, CJS so `require()` still works.
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  // Node 18 is the floor because that is where fetch became built in, which is
  // what lets this package ship with no runtime dependencies at all.
  target: "node18",
  // Sent as the User-Agent, so request logs show which SDK version called.
  define: { __SDK_VERSION__: JSON.stringify(version) },
  },
  /*
   * The `npx sendpository` command. ESM only and no types - it is run, never
   * imported - and built without `clean` so it doesn't wipe the library.
   */
  {
    entry: { cli: "src/bin.ts" },
    format: ["esm"],
    target: "node18",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
