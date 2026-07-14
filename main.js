const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { chromium } = require("playwright");

const TEST_URL = "https://onlinetyping.org/10-key-typing-test/10-key-5-minutes.php";
const TEST_DURATION_SEC = 300;

let mainWindow;
let browser = null;
let page = null;
let running = false;
let stopRequested = false;

function log(msg) {
  console.log("[MAIN]", msg);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log", String(msg));
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 700,
    resizable: false,`n    alwaysOnTop: true,
    frame: false,
    transparent: false,
    backgroundColor: "#FAF8F5",
    title: "OnlineTypng - 10-Key Automation",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, "icon.png"),
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  log("App starting...");
  createWindow();
});
app.on("window-all-closed", () => { app.quit(); });

// Window controls
ipcMain.on("window-minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on("window-close", () => { if (mainWindow) mainWindow.close(); });

// Start automation
ipcMain.handle("start", async (event, targetKPH) => {
  if (running) return { error: "Already running" };
  running = true;
  stopRequested = false;

  log("Starting automation, target KPH=" + targetKPH);
  const c = Math.round(targetKPH / 60);
  const actualKPH = 60 * c;
  const groupCount = Math.round((5 * c) / 6);
  const actualTyped = groupCount * 6;
  const totalMs = TEST_DURATION_SEC * 1000;
  const intervalPerGroup = totalMs / groupCount;

  mainWindow.webContents.send("status", { 
    phase: "running", actualKPH, groupCount, actualTyped 
  });
  log("Actual KPH=" + actualKPH + " Groups=" + groupCount);

  try {
    log("Launching Chrome...");
    browser = await chromium.launch({ 
      headless: false, 
      channel: "chrome",
      args: [
        "--start-maximized",
        "--disable-blink-features=AutomationControlled"
      ],
    });
    log("Chrome launched");
    
    const ctx = await browser.newContext({ viewport: null });
    page = await ctx.newPage();
    
    log("Loading test page...");
    await page.goto(TEST_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    
    await page.waitForSelector("#typebox", { timeout: 10000 });
    await page.waitForSelector(".current-word", { timeout: 10000 });
    log("Page loaded");
    
    await sleep(2000);
  } catch (e) {
    log("Launch failed: " + e.message);
    running = false;
    mainWindow.webContents.send("error", "Browser launch failed: " + e.message);
    return { error: e.message };
  }

  const startTime = Date.now();
  let completed = 0;
  let errors = 0;

  for (let i = 0; i < groupCount; i++) {
    if (stopRequested) { log("User stopped"); break; }

    const targetStart = startTime + i * intervalPerGroup;
    const waitTime = targetStart - Date.now();
    if (waitTime > 0) await sleep(waitTime);

    let word;
    try {
      word = await page.evaluate(() => {
        const el = document.querySelector(".current-word");
        return el ? el.innerHTML : null;
      });
    } catch (e) {
      errors++;
      if (errors > 5) { log("Read failures exceeded"); break; }
      continue;
    }

    if (!word) { log("No current word, test may have ended"); break; }

    try {
      await page.evaluate(() => { 
        const b = document.getElementById("typebox"); 
        if (b) b.value = ""; 
      });
      await page.focus("#typebox");
      await page.type("#typebox", word, { delay: 25 });
      await page.keyboard.press("Enter");
      completed++;
      errors = 0;
    } catch (e) {
      errors++;
      if (errors > 5) { log("Type failures: " + e.message); break; }
      continue;
    }

    // Real-time stats broadcast every iteration
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
    const charsTyped = completed * 6;
    const currentKPH = elapsed > 0 ? Math.round(charsTyped * (3600000 / elapsed)) : 0;
    const pct = Math.round(completed / groupCount * 100);
    
    mainWindow.webContents.send("realtime", {
      pct, completed, groupCount, remaining, charsTyped, currentKPH
    });
  }

  log("Typing done, " + completed + " groups. Waiting for results...");
  await sleep(5000);

  try {
    await page.waitForFunction(() => {
      return document.querySelector("#results") || document.querySelector("#done");
    }, { timeout: 10000 });
  } catch (e) {
    log("Wait for results timeout");
  }
  await sleep(1000);

  try {
    const doneBtn = await page.$("#done");
    if (doneBtn) { 
      await doneBtn.click(); 
      await sleep(2000); 
    }
  } catch (e) {}

  let results = { kph: "N/A", accuracy: "N/A", chars: "N/A" };
  try {
    results = await page.evaluate(() => {
      const items = document.querySelectorAll("#results .wpm-value");
      const statsSpan = document.querySelector("#results-stats span");
      return {
        kph: items[0]?.textContent?.trim() || "N/A",
        accuracy: items[1]?.textContent?.trim() || "N/A",
        chars: statsSpan?.textContent?.trim() || "N/A",
      };
    });
    log("Results: KPH=" + results.kph + " Acc=" + results.accuracy + " Chars=" + results.chars);
  } catch (e) {
    log("Read results failed: " + e.message);
  }

  running = false;
  mainWindow.webContents.send("done", { ...results, completed, targetKPH, actualKPH });
  return { success: true };
});

ipcMain.handle("stop", async () => {
  stopRequested = true;
  log("Stop requested");
  if (page) {
    try {
      await page.evaluate(() => {
        const btn = document.querySelector("#done");
        if (btn) btn.click();
      });
    } catch(e) {}
  }
  return { ok: true };
});

ipcMain.handle("closeBrowser", async () => {
  log("Closing browser");
  try { if (browser) await browser.close(); } catch(e) {}
  browser = null;
  page = null;
  running = false;
  return { ok: true };
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }