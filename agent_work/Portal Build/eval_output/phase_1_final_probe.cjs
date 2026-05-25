const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = "C:/Users/NickW/Claude/windows automation/daypilot/agent_work/eval_output";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profileDir = path.join(root, "chrome-profile-final-eval");
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
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  async waitFor(method, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const index = this.events.findIndex((event) => event.method === method);
      if (index >= 0) return this.events.splice(index, 1)[0];
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${method}`);
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

async function saveScreenshot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  const file = path.join(root, name);
  await fs.writeFile(file, Buffer.from(data, "base64"));
  return file;
}

async function mouseClick(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

async function bodyText(cdp) {
  return evalExpr(cdp, "document.body.innerText");
}

async function clickByTerms(cdp, terms) {
  const expression = `
    (() => {
      const items = ${JSON.stringify(terms)};
      const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
      const target = nodes.find((el) => {
        const text = (el.innerText || '').trim();
        return items.some((item) => text === item || text.includes(item));
      });
      if (!target) return { clicked: false };
      target.click();
      return { clicked: true, text: (target.innerText || '').trim(), tag: target.tagName, href: target.getAttribute('href') };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function clickTicket(cdp, ticketId) {
  const expression = `
    (() => {
      const id = ${JSON.stringify(ticketId)};
      const nodes = [...document.querySelectorAll('tr, [role="row"], button, a, [role="button"], div')];
      const target = nodes.find((el) => (el.innerText || '').includes(id));
      if (!target) return { clicked: false };
      const clickable = target.closest('button, a, [role="button"], tr, [role="row"]') || target;
      clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return { clicked: true, text: (clickable.innerText || '').trim(), tag: clickable.tagName };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function fillFirstEditable(cdp, value) {
  const expression = `
    (() => {
      const el = document.querySelector('textarea, input[type="text"], input:not([type])');
      if (!el) return { filled: false };
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: true, tag: el.tagName, placeholder: el.getAttribute('placeholder') };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function clickSendButton(cdp) {
  const buttonInfo = await evalExpr(
    cdp,
    `
    (() => {
      const textarea = document.querySelector('textarea');
      if (!textarea) return { found: false };
      const textRect = textarea.getBoundingClientRect();
      const buttons = [...document.querySelectorAll('button, [role="button"]')].filter((el) => !el.disabled);
      const target = buttons.find((el) => {
        const rect = el.getBoundingClientRect();
        const verticalOverlap = rect.bottom >= textRect.top && rect.top <= textRect.bottom;
        const toRight = rect.left >= textRect.right - 5;
        return rect.width > 20 && rect.height > 20 && verticalOverlap && toRight;
      }) || buttons
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 20 && rect.height > 20;
        })
        .sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (rb.left - ra.left) || (rb.top - ra.top);
        })[0];
      if (!target) return { found: false };
      const rect = target.getBoundingClientRect();
      return {
        found: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: (target.innerText || '').trim(),
        ariaLabel: target.getAttribute('aria-label'),
        title: target.getAttribute('title')
      };
    })()
  `
  );
  if (!buttonInfo?.found) return { clicked: false };
  await mouseClick(cdp, buttonInfo.x, buttonInfo.y);
  return { clicked: true, ...buttonInfo };
}

async function visibleLeakTerms(cdp) {
  const expression = `
    (() => {
      const text = document.body.innerText || '';
      const leakTerms = [
        'Triaged',
        'Categorised',
        'Escalated',
        'Waiting for Customer',
        'Pending Customer',
        'With Third Party',
        'handed_off'
      ];
      return leakTerms.filter((term) => text.includes(term));
    })()
  `;
  return evalExpr(cdp, expression);
}

async function captureState(cdp, name) {
  return {
    url: await evalExpr(cdp, "location.href"),
    text: await bodyText(cdp),
    leaks: await visibleLeakTerms(cdp),
    screenshot: await saveScreenshot(cdp, `${name}.png`),
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
      "--remote-debugging-port=9224",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    const version = await fetchJson("http://127.0.0.1:9224/json/version");
    const browserCdp = new CDP(version.webSocketDebuggerUrl);
    await browserCdp.ready();
    const { targetId } = await browserCdp.send("Target.createTarget", { url: baseUrl });
    const targets = await fetchJson("http://127.0.0.1:9224/json/list", 20);
    const target = targets.find((item) => item.id === targetId);
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.waitFor("Page.loadEventFired", 20000).catch(() => {});
    await delay(4000);

    const report = {};

    report.home = await captureState(cdp, "phase_1_final_home");

    report.gotoTickets = await clickByTerms(cdp, ["My Tickets"]);
    await delay(2500);
    report.tickets = await captureState(cdp, "phase_1_final_tickets");

    report.cod101Click = await clickTicket(cdp, "COD-101");
    await delay(2500);
    report.cod101 = await captureState(cdp, "phase_1_final_cod101");

    report.backFrom101 = await clickByTerms(cdp, ["Back to tickets"]);
    await delay(2000);

    report.cod102Click = await clickTicket(cdp, "COD-102");
    await delay(2500);
    report.cod102 = await captureState(cdp, "phase_1_final_cod102");

    report.backFrom102 = await clickByTerms(cdp, ["Back to tickets"]);
    await delay(2000);

    report.cod103Click = await clickTicket(cdp, "COD-103");
    await delay(2500);
    report.cod103 = await captureState(cdp, "phase_1_final_cod103");

    report.backFrom103 = await clickByTerms(cdp, ["Back to tickets"]);
    await delay(2000);

    report.homeFromTickets = await clickByTerms(cdp, ["Home"]);
    await delay(2000);

    report.openGetHelp = await clickByTerms(cdp, ["Get help"]);
    await delay(2500);
    report.getHelpStart = await captureState(cdp, "phase_1_final_get_help_start");

    report.intakeMessage1 = await fillFirstEditable(
      cdp,
      "The branch mailbox is not receiving password reset emails. Please help restore access before tomorrow morning."
    );
    report.intakeSubmit1 = await clickSendButton(cdp);
    await delay(2500);
    report.afterMessage1 = await captureState(cdp, "phase_1_final_after_message_1");

    report.chooseCategory = await clickByTerms(cdp, ["My Account"]);
    await delay(2500);
    report.afterCategory = await captureState(cdp, "phase_1_final_after_category");

    report.intakeMessage2 = await fillFirstEditable(
      cdp,
      "The user clicks Forgot password on the login page, but the reset email never arrives in branch.mailbox@example.com. No error is shown after submit."
    );
    report.intakeSubmit2 = await clickSendButton(cdp);
    await delay(2500);
    report.afterMessage2 = await captureState(cdp, "phase_1_final_after_message_2");

    report.submitRequest = await clickByTerms(cdp, ["Submit request", "Submit Request"]);
    await delay(2500);
    report.afterSubmit = await captureState(cdp, "phase_1_final_after_submit");

    report.viewTicket = await clickByTerms(cdp, ["View Ticket"]);
    await delay(2500);
    report.newTicket = await captureState(cdp, "phase_1_final_new_ticket");

    await fs.writeFile(path.join(root, "phase_1_final_probe_report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    chrome.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
