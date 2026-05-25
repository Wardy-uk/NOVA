const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = "C:/Users/NickW/Claude/windows automation/daypilot/agent_work/eval_output";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profileDir = path.join(root, "chrome-profile-eval");
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

async function postJson(url, retries = 20) {
  let lastErr;
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await fetch(url, { method: "PUT" });
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
      if (index >= 0) {
        return this.events.splice(index, 1)[0];
      }
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

async function clickByText(cdp, text) {
  const expression = `
    (() => {
      const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
      const target = nodes.find((el) => (el.innerText || '').trim() === ${JSON.stringify(text)} || (el.innerText || '').includes(${JSON.stringify(text)}));
      if (!target) return { clicked: false };
      target.click();
      return { clicked: true, text: (target.innerText || '').trim(), tag: target.tagName };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function fillFirstInput(cdp, value) {
  const expression = `
    (() => {
      const el = document.querySelector('textarea, input[type="text"], input:not([type])');
      if (!el) return { filled: false };
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: true, tag: el.tagName, placeholder: el.getAttribute('placeholder') };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function clickSubmit(cdp) {
  const expression = `
    (() => {
      const nodes = [...document.querySelectorAll('button, [role="button"]')];
      const target = nodes.find((el) => {
        const text = (el.innerText || '').trim();
        const label = (el.getAttribute('aria-label') || '').trim();
        return ['Send', 'Submit', 'Continue', 'Next', 'Get Help', 'Start'].includes(text) || /send|submit|continue|next|get help|start/i.test(text) || /send|submit/i.test(label);
      });
      if (!target) return { clicked: false };
      target.click();
      return { clicked: true, text: (target.innerText || '').trim(), ariaLabel: target.getAttribute('aria-label') };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function bodyText(cdp) {
  return evalExpr(cdp, "document.body.innerText");
}

async function hrefs(cdp) {
  return evalExpr(
    cdp,
    `(() => [...document.querySelectorAll('a, button')].map((el) => ({
      tag: el.tagName,
      text: (el.innerText || '').trim(),
      href: el.getAttribute('href'),
      type: el.getAttribute('type')
    })))()`
  );
}

async function interactiveElements(cdp) {
  return evalExpr(
    cdp,
    `(() => [...document.querySelectorAll('a, button, [role="button"], input, textarea, select')].map((el) => ({
      tag: el.tagName,
      text: (el.innerText || el.value || '').trim(),
      href: el.getAttribute('href'),
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder'),
      disabled: !!el.disabled
    })))()`
  );
}

async function visibleStatuses(cdp) {
  const expression = `
    (() => {
      const allowed = ['Submitted','Reviewed','In Progress','Awaiting Your Response','Awaiting Third Party','Resolved','Closed'];
      const text = document.body.innerText || '';
      const hits = allowed.filter((status) => text.includes(status));
      const rawSuspects = ['Triaged','Categorised','Escalated','Waiting for Customer','Pending Customer','With Third Party'];
      const leaks = rawSuspects.filter((status) => text.includes(status));
      return { hits, leaks, text };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function currentUrl(cdp) {
  return evalExpr(cdp, "location.href");
}

async function clickMatching(cdp, candidates) {
  const expression = `
    (() => {
      const terms = ${JSON.stringify(candidates)};
      const nodes = [...document.querySelectorAll('button, a, [role="button"]')];
      const target = nodes.find((el) => {
        const text = (el.innerText || '').trim();
        return terms.some((term) => text === term || text.includes(term));
      });
      if (!target) return { clicked: false };
      target.click();
      return { clicked: true, text: (target.innerText || '').trim(), tag: target.tagName, href: target.getAttribute('href') };
    })()
  `;
  return evalExpr(cdp, expression);
}

async function clickFirstTicketLike(cdp) {
  const expression = `
    (() => {
      const selectors = [
        'button',
        '[data-testid*="ticket"]',
        'a[href*="/portal/tickets/"]',
        'a[href*="/tickets/"]',
        'button[data-ticket-id]',
        '[role="row"] a',
        'table a',
        'li a'
        ];
        for (const selector of selectors) {
          const nodes = [...document.querySelectorAll(selector)].filter((el) => {
            const text = (el.innerText || '').trim();
            const href = el.getAttribute('href') || '';
            return text.length > 0 && (/COD-\\d+/i.test(text) || text.includes('Reviewed') || text.includes('Awaiting Your Response') || href.includes('/tickets/'));
          });
          if (nodes.length > 0) {
            const target = nodes[0];
            target.click();
          return { clicked: true, selector, text: (target.innerText || '').trim(), href: target.getAttribute('href') };
        }
      }
      return { clicked: false };
    })()
  `;
  return evalExpr(cdp, expression);
}

function recentEvents(cdp, methods) {
  return cdp.events
    .filter((event) => methods.includes(event.method))
    .slice(-25)
    .map((event) => ({ method: event.method, params: event.params }));
}

async function main() {
  await fs.mkdir(profileDir, { recursive: true });
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--remote-debugging-port=9223",
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  try {
    const version = await fetchJson("http://127.0.0.1:9223/json/version");
    const browserCdp = new CDP(version.webSocketDebuggerUrl);
    await browserCdp.ready();
    const { targetId } = await browserCdp.send("Target.createTarget", { url: baseUrl });
    const targets = await fetchJson("http://127.0.0.1:9223/json/list", 20);
    const target = targets.find((item) => item.id === targetId);
    if (!target) {
      throw new Error("Created target not found in target list");
    }
    const cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable").catch(() => {});
    await cdp.waitFor("Page.loadEventFired", 20000).catch(() => {});
    await delay(4000);

    const report = {};
    report.landingText = await bodyText(cdp);
    report.landingUrl = await currentUrl(cdp);
    report.landingLinks = await hrefs(cdp);
    report.landingInteractive = await interactiveElements(cdp);
    report.landingStatuses = await visibleStatuses(cdp);
    report.landingShot = await saveScreenshot(cdp, "phase1_landing.png");

    report.codexButtonClick = await clickMatching(cdp, ["Use Codex Test User", "Codex Test User"]);
    await delay(2000);
    report.signInClick = await clickMatching(cdp, ["Sign in with Nurtur"]);
    await delay(4500);
    report.afterSignInUrl = await evalExpr(cdp, "location.href");
    report.afterSignInText = await bodyText(cdp);
    report.afterSignInLinks = await hrefs(cdp);
    report.afterSignInInteractive = await interactiveElements(cdp);
    report.afterSignInEvents = recentEvents(cdp, [
      "Network.requestWillBeSent",
      "Network.responseReceived",
      "Runtime.exceptionThrown",
      "Log.entryAdded",
      "Page.windowOpen",
    ]);
    report.afterSignInShot = await saveScreenshot(cdp, "phase1_after_sign_in.png");

    report.ticketListStatuses = await visibleStatuses(cdp);
    report.openTicket = await clickFirstTicketLike(cdp);
    await delay(3000);
    report.ticketDetailUrl = await currentUrl(cdp);
    report.ticketDetailText = await bodyText(cdp);
    report.ticketDetailInteractive = await interactiveElements(cdp);
    report.ticketDetailStatuses = await visibleStatuses(cdp);
    report.ticketDetailShot = await saveScreenshot(cdp, "phase1_ticket_detail.png");

    report.firstGetHelp = await clickMatching(cdp, ["Get Help", "New Request", "Create Request", "Submit Request"]);
    await delay(2500);
    report.afterGetHelpText = await bodyText(cdp);
    report.afterGetHelpInteractive = await interactiveElements(cdp);
    report.afterGetHelpShot = await saveScreenshot(cdp, "phase1_after_get_help.png");

    report.fillIssue = await fillFirstInput(cdp, "My ticket says categorised and I need help understanding the status.");
    report.submitIssue = await clickSubmit(cdp);
    await delay(2500);
    report.afterFirstInputText = await bodyText(cdp);
    report.afterFirstInputShot = await saveScreenshot(cdp, "phase1_after_first_input.png");

    report.secondInput = await fillFirstInput(cdp, "I can provide more details if needed.");
    report.secondSubmit = await clickSubmit(cdp);
    await delay(2500);
    report.afterSecondInputText = await bodyText(cdp);
    report.afterSecondInputShot = await saveScreenshot(cdp, "phase1_after_second_input.png");

    report.finalStatuses = await visibleStatuses(cdp);
    await fs.writeFile(path.join(root, "phase1_browser_report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    chrome.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
