import { execFileSync } from "child_process";
import os from "os";

const port = String(process.env.PORT || 3847);

if (os.platform() !== "win32") {
  process.exit(0);
}

try {
  const out = execFileSync("netstat", ["-ano"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (
      !trimmed.includes("LISTENING") ||
      !trimmed.includes(`:${port}`)
    ) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid)) pids.add(pid);
  }
  for (const pid of pids) {
    try {
      execFileSync("taskkill", ["/F", "/PID", pid], {
        stdio: "pipe",
        windowsHide: true,
      });
      console.error(`Porta ${port}: processo ${pid} encerrado.`);
    } catch {
      /* ignorar */
    }
  }
} catch {
  /* netstat indisponível */
}
