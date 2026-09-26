import { main } from "./cli.js";

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
