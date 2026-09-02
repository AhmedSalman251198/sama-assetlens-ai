import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const forwarded = [];
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--strictPort") continue;
  forwarded.push(argument === "--host" ? "--hostname" : argument);
}

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const child = spawn(process.execPath, [nextBin, "dev", "--webpack", ...forwarded], { stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
