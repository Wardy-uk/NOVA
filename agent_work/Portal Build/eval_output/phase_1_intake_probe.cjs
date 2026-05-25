const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = "C:/Users/NickW/Claude/windows automation/daypilot/agent_work/eval_output";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profileDir = path.join(root, "chrome-profile-intake-eval");
const baseUrl = "http://127.0.0.1:5173/portal?codexTestUser=1";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, retries = 20) {
  let lastErr;
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await delay(500);
    }
  }
  throw lastErr;
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const pending = this.pending.get(msg.id);
        if (!pending) return;
        this.pending.delete(msg.id);
        if (msg.error) pending.reject(new Error(JSON.stringify(msg.error)));
        else pending.resolve(msg.result);
        return;
      }
      this.events.push(msg);
    });
  }

  async ready() {
    if (this.ws.readyState === this.ws.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function evalExpr(cdp, expression) {
  const { result } = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.value;
}

async function click(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function key(cdp, type, key, code, windowsVirtualKeyCode) {
  await cdp.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode });
}

async function pressKey(cdp, keyName, code, keyCode) {
  await key(cdp, "keyDown", keyName, code, keyCode);
  await key(cdp, "keyUp", keyName, code, keyCode);
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const file = path.join(root, name);
  await fs.writeFile(file, Buffer.from(data, "base64"));
  return file;
}

async function text(cdp) {
  return evalExpr(cdp, "document.body.innerText");
}

async function elementCenter(cdp, selector, containsText = null) {
  const expression = `
    (() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const node = ${containsText ? `nodes.find((el) => (el.innerText || '').includes(${JSON.stringify(containsText)}))` : `nodes[0]`};
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: (node.innerText || '').trim(),
        tag: node.tagName
      };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function sendButtonCenter(cdp) {
  const expression = `
    (() => {
      const textarea = document.querySelector('textarea');
      if (!textarea) return null;
      const textRect = textarea.getBoundingClientRect();
      const nodes = [...document.querySelectorAll('button, [role="button"]')].filter((el) => !el.disabled);
      const node = nodes.find((el) => {
        const rect = el.getBoundingClientRect();
        const verticalOverlap = rect.bottom >= textRect.top && rect.top <= textRect.bottom;
        return rect.left >= textRect.right - 5 && verticalOverlap;
      });
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: (node.innerText || '').trim(),
        ariaLabel: node.getAttribute('aria-label')
      };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function saveState(cdp, name) {
  return {
    text: await text(cdp),
    screenshot: await screenshot(cdp, name),
  };
}

async function main() {
  await fs.mkdir(profileDir, { recursive: true });
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=9225",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    const version = await fetchJson("http://127.0.0.1:9225/json/version");
    const browserCdp = new CDP(version.webSocketDebuggerUrl);
    await browserCdp.ready();
    const { targetId } = await browserCdp.send("Target.createTarget", { url: baseUrl });
    const targets = await fetchJson("http://127.0.0.1:9225/json/list", 20);
    const target = targets.find((item) => item.id === targetId);
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await delay(5000);

    const getHelp = await elementCenter(cdp, "button, a, [role='button']", "Get help");
    await click(cdp, getHelp.x, getHelp.y);
    await delay(1500);
    await screenshot(cdp, "phase_1_intake_probe_start.png");

    const textarea = await elementCenter(cdp, "textarea");
    await click(cdp, textarea.x, textarea.y);
    await cdp.send("Input.insertText", {
      text: "The branch mailbox is not receiving password reset emails. Please help restore access before tomorrow morning."
    });
    await delay(500);
    const send = await sendButtonCenter(cdp);
    await click(cdp, send.x, send.y);
    await delay(2500);

    const after1 = await saveState(cdp, "phase_1_intake_probe_after_1.png");

    const account = await elementCenter(cdp, "button, [role='button']", "My Account");
    await click(cdp, account.x, account.y);
    await delay(2500);
    const afterCategory = await saveState(cdp, "phase_1_intake_probe_after_category.png");

    const textarea2 = await elementCenter(cdp, "textarea");
    await click(cdp, textarea2.x, textarea2.y);
    await cdp.send("Input.insertText", {
      text: "The user clicks Forgot password on the login page, but the reset email never arrives in branch.mailbox@example.com. No error is shown after submit."
    });
    await delay(500);
    const send2 = await sendButtonCenter(cdp);
    await click(cdp, send2.x, send2.y);
    await delay(2500);
    const after2 = await saveState(cdp, "phase_1_intake_probe_after_2.png");

    const submit = await elementCenter(cdp, "button, [role='button']", "Submit request");
    if (submit) {
      await click(cdp, submit.x, submit.y);
      await delay(2500);
    }
    const afterSubmit = await saveState(cdp, "phase_1_intake_probe_after_submit.png");

    const viewTicket = await elementCenter(cdp, "button, [role='button']", "View Ticket");
    if (viewTicket) {
      await click(cdp, viewTicket.x, viewTicket.y);
      await delay(2500);
    }
    const finalTicket = await saveState(cdp, "phase_1_intake_probe_final_ticket.png");

    const result = { send, after1, account, afterCategory, send2, after2, submit, afterSubmit, viewTicket, finalTicket };
    await fs.writeFile(path.join(root, "phase_1_intake_probe.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    chrome.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
