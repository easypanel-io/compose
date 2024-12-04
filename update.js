import { execa } from "execa";
import { glob } from "glob";
import path from "path";

const files = await glob("*/update.js", { absolute: true });

for (const file of files) {
  console.log(`Executing ${file}`);

  await execa("node", ["update.js"], {
    stdio: "inherit",
    cwd: path.dirname(file),
  });

  console.log(`--------------------------------`);
}
