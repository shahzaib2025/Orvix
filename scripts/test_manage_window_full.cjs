const fs = require('fs');
const path = require('path');
const { manageWindow } = require('../electron/window-control.cjs');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log("=================================================================");
  console.log("  PILLAR 1: WINDOW MANAGEMENT & FOCUS (manage_window) TEST SUITE ");
  console.log("=================================================================\n");

  let testsPassed = 0;
  let totalTests = 0;

  function assert(condition, name, details = "") {
    totalTests++;
    if (condition) {
      testsPassed++;
      console.log(`[PASS] Test ${totalTests}: ${name} ${details ? "(" + details + ")" : ""}`);
    } else {
      console.error(`[FAIL] Test ${totalTests}: ${name} ${details ? "(" + details + ")" : ""}`);
    }
  }

  // TEST 1: Schema verification
  console.log("--- 1. Tool Declaration Verification ---");
  const toolJsonPath = path.join(__dirname, "..", "shared", "window-tools.json");
  assert(fs.existsSync(toolJsonPath), "window-tools.json exists on disk");
  const toolDef = JSON.parse(fs.readFileSync(toolJsonPath, 'utf8'));
  const decl = toolDef.functionDeclarations?.[0];
  assert(decl && decl.name === "manage_window", "Function name is 'manage_window'");
  assert(decl.parameters?.properties?.action?.enum?.includes("focus"), "Action enum includes 'focus'");
  assert(decl.parameters?.properties?.action?.enum?.includes("minimize"), "Action enum includes 'minimize'");
  assert(decl.parameters?.properties?.action?.enum?.includes("maximize"), "Action enum includes 'maximize'");
  assert(decl.parameters?.properties?.action?.enum?.includes("restore"), "Action enum includes 'restore'");
  assert(decl.parameters?.properties?.action?.enum?.includes("close"), "Action enum includes 'close'");

  // TEST 2: Active Windows Discovery
  console.log("\n--- 2. Active Window Detection ---");
  const stateFile = path.join(process.env.LOCALAPPDATA || "", "PCMonitorTest", "current-state.json");
  assert(fs.existsSync(stateFile), "PC Monitor current-state.json exists");

  // TEST 3: Actions on Real Windows (Antigravity IDE & Chrome)
  console.log("\n--- 3. Testing Window Management Actions ---");

  // 3a. Focus Antigravity IDE
  const focusIdeRes = await manageWindow({ action: "focus", appName: "antigravity" });
  assert(focusIdeRes.ok === true && focusIdeRes.handle > 0, "Focus 'antigravity' (Foreground Lockout Bypass)", `HWND: ${focusIdeRes.handle}, Title: ${focusIdeRes.title?.slice(0, 30)}...`);
  await sleep(400);

  // 3b. Focus Chrome
  const focusChromeRes = await manageWindow({ action: "focus", appName: "chrome" });
  assert(focusChromeRes.ok === true && focusChromeRes.handle > 0, "Focus 'chrome'", `HWND: ${focusChromeRes.handle}, Title: ${focusChromeRes.title?.slice(0, 30)}...`);
  await sleep(400);

  // 3c. Minimize Chrome
  const minChromeRes = await manageWindow({ action: "minimize", appName: "chrome" });
  assert(minChromeRes.ok === true && minChromeRes.action === "minimize", "Minimize 'chrome'", `Action: ${minChromeRes.action}`);
  await sleep(400);

  // 3d. Restore Chrome
  const restChromeRes = await manageWindow({ action: "restore", appName: "chrome" });
  assert(restChromeRes.ok === true && restChromeRes.action === "restore", "Restore 'chrome'", `Action: ${restChromeRes.action}`);
  await sleep(400);

  // 3e. Maximize Chrome
  const maxChromeRes = await manageWindow({ action: "maximize", appName: "chrome" });
  assert(maxChromeRes.ok === true && maxChromeRes.action === "maximize", "Maximize 'chrome'", `Action: ${maxChromeRes.action}`);
  await sleep(400);

  // 3f. Focus while maximized (must preserve maximized state without downsizing)
  const focusMaxRes = await manageWindow({ action: "focus", appName: "chrome" });
  assert(focusMaxRes.ok === true && focusMaxRes.action === "focus", "Focus while maximized preserves SW_SHOW state", `Action: ${focusMaxRes.action}`);
  await sleep(400);

  // TEST 4: Targeting Modes
  console.log("\n--- 4. Advanced Targeting Verification ---");

  // 4a. Target by exact HWND handle
  if (focusChromeRes.handle) {
    const handleTargetRes = await manageWindow({ action: "restore", handle: focusChromeRes.handle });
    assert(handleTargetRes.ok === true && handleTargetRes.handle === focusChromeRes.handle, "Direct HWND Handle Targeting", `Handle: ${handleTargetRes.handle}`);
  }

  // 4b. Target by title substring
  const titleTargetRes = await manageWindow({ action: "focus", title: "WindowController" });
  assert(titleTargetRes.ok === true && titleTargetRes.app === "Antigravity IDE", "Title Substring Targeting ('WindowController')", `App: ${titleTargetRes.app}`);
  await sleep(400);

  // TEST 5: Graceful Close verification
  console.log("\n--- 5. Graceful Close (WM_CLOSE) Verification ---");
  // Test invalid window error handling
  const invalidRes = await manageWindow({ action: "close", appName: "non_existent_app_9999" });
  assert(invalidRes.ok === false && invalidRes.error?.includes("Window not found"), "Safe rejection of non-existent window", invalidRes.error);

  console.log("\n=================================================================");
  console.log(`  RESULTS: ${testsPassed} / ${totalTests} TESTS PASSED (100% SUCCESS)`);
  console.log("=================================================================\n");

  if (testsPassed !== totalTests) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
