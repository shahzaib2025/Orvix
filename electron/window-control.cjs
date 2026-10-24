const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

function getPairingToken() {
  try {
    const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local");
    const tokenFile = path.join(localAppData, "PCMonitorTest", "pairing-token.txt");
    if (fs.existsSync(tokenFile)) {
      return fs.readFileSync(tokenFile, "utf8").trim();
    }
  } catch {
    // Non-blocking
  }
  return "";
}

function callHttpAction(payload, timeoutMs = 800) {
  return new Promise((resolve, reject) => {
    const token = getPairingToken();
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: 49491,
        path: "/action",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          "X-PC-Monitor-Token": token,
        },
        timeout: timeoutMs,
      },
      res => {
        let body = "";
        res.on("data", chunk => (body += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch {
            resolve({ ok: res.statusCode === 200, raw: body });
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("HTTP /action timeout"));
    });

    req.write(data);
    req.end();
  });
}

function getForegroundHandle() {
  return new Promise(resolve => {
    const req = http.request({ hostname: "127.0.0.1", port: 49491, path: "/foreground", method: "GET",
      headers: { "X-PC-Monitor-Token": getPairingToken() }, timeout: 700 }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        try {
          const handle = JSON.parse(body).handle;
          resolve(res.statusCode === 200 && Number.isSafeInteger(handle) && handle > 0 ? handle : 0);
        } catch { resolve(0); }
      });
    });
    req.on("error", () => resolve(0));
    req.on("timeout", () => { req.destroy(); resolve(0); });
    req.end();
  });
}

function callCliAction(payload) {
  return new Promise(resolve => {
    const bundledPath = path.join(process.resourcesPath || "", "PC-Monitor-Test", "bin", "PCMonitor.exe");
    const exePath = fs.existsSync(bundledPath) ? bundledPath : path.join(__dirname, "..", "PC-Monitor-Test", "bin", "PCMonitor.exe");
    if (!fs.existsSync(exePath)) {
      resolve({ ok: false, error: `PCMonitor.exe not found at ${exePath}` });
      return;
    }

    const args = [`--action=${payload.action}`];
    if (payload.handle) args.push(`--handle=${payload.handle}`);
    if (payload.appName) args.push(`--app=${payload.appName}`);
    if (payload.title) args.push(`--title=${payload.title}`);

    execFile(exePath, args, { timeout: 3000, encoding: "utf8" }, (err, stdout, stderr) => {
      const output = (stdout || stderr || "").trim();
      try {
        const parsed = JSON.parse(output);
        resolve(parsed);
      } catch {
        if (err) {
          resolve({ ok: false, error: err.message, raw: output });
        } else {
          resolve({ ok: true, raw: output });
        }
      }
    });
  });
}

async function manageWindow(input = {}) {
  const rawAction = (input.action || "").trim().toLowerCase();
  let action = "focus";
  if (rawAction.includes("min")) action = "minimize";
  else if (rawAction.includes("max")) action = "maximize";
  else if (rawAction.includes("rest")) action = "restore";
  else if (rawAction.includes("close") || rawAction.includes("quit") || rawAction.includes("exit")) action = "close";
  else if (rawAction.includes("focus") || rawAction.includes("front") || rawAction.includes("activate")) action = "focus";

  const appName = (input.appName || input.app || "").trim();
  const title = (input.title || "").trim();
  const handle = typeof input.handle === "number" ? input.handle : parseInt(input.handle, 10) || 0;

  const payload = {
    action,
    appName: appName || undefined,
    title: title || (appName ? appName : undefined),
    handle: handle > 0 ? handle : undefined,
  };

  // 1. Try Fast HTTP path first (< 1ms when daemon is running)
  try {
    const httpResult = await callHttpAction(payload, 600);
    return {
      status: httpResult.ok ? "ok" : "failed",
      ...httpResult,
    };
  } catch (error) {
    // Daemon not running or port busy -> Fallback to direct CLI invocation
    // A sent quick action may have taken effect before its HTTP response failed.
    // Only connection refusal proves the daemon received no request.
    if (["focus", "minimize", "maximize"].includes(action) && error.code !== "ECONNREFUSED")
      return {status:"dispatched",ok:false,action,completionUnknown:true,error:"Window action response unavailable; observe the window before retrying."};
  }

  // 2. Direct CLI fallback
  const cliResult = await callCliAction(payload);
  if (!cliResult.ok) {
    console.error(`[Orvix Tool Error: manage_window] Action '${action}' on '${appName || title}' failed:`, cliResult.error || cliResult.raw);
  }
  return {
    status: cliResult.ok ? "ok" : "failed",
    ...cliResult,
  };
}

module.exports = {
  manageWindow,
  getForegroundHandle,
};
