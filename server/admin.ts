// Entry point for `npm run admin`. The commands are in admin-commands.ts.
import "dotenv/config";
import fs from "node:fs";
import readline from "node:readline/promises";
import { AdminError, runAdmin } from "./admin-commands.ts";
import { openDatabase } from "./db.ts";

const databasePath = process.env.SQLITE_PATH ?? "data/attendance.sqlite";

process.exitCode = await runAdmin(process.argv.slice(2), {
  databasePath,
  open() {
    // Opening a missing file would create an empty database and report on that.
    if (!fs.existsSync(databasePath)) {
      throw new AdminError(
        `There is no database at ${databasePath}. Run this from the API's directory on the instance, or set SQLITE_PATH.`,
      );
    }
    return openDatabase(databasePath);
  },
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  async confirm(question) {
    if (!process.stdin.isTTY) {
      console.error(`${question}\nThere is no terminal to answer on. Add --yes to go ahead.`);
      return false;
    }
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string | null>((resolve) => {
      // Ctrl+C and Ctrl+D close the prompt without an answer, which counts as no.
      prompt.on("SIGINT", () => prompt.close());
      prompt.on("close", () => resolve(null));
      prompt.question(`${question} [y/N] `).then(resolve, () => resolve(null));
    });
    if (answer === null) console.log();
    prompt.close();
    return /^y(es)?$/i.test(answer?.trim() ?? "");
  },
  now: () => new Date(),
});
