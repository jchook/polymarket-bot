import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { versionString } from "./version";

const execFileAsync = promisify(execFile);

export async function getVersionString(): Promise<string> {
  try {
    if (process.env.NODE_ENV !== "development") {
      const scriptPath = path.resolve(__dirname, "../../bin/version");
      const { stdout } = await execFileAsync(scriptPath);
      return stdout.trim();
    }
  } catch (_err) {}
  return versionString;
}
