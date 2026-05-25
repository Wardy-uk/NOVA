import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORTAL = 'http://127.0.0.1:5174/portal?codexTestUser=1';
const OUT = 'c:/Users/NickW/Claude/windows automation/daypilot/agent_work/eval_output';

const scenarios = [
  {
    id: 1,
    name: 'Simple Content Change',
    message: 'Our homepage phone number is wrong. It should be 01234 567890.',
  },
  {
    id: 2,
    name: 'Information-Rich Request',
    message: "Our website nurturtest.com has the wrong phone number on the contact page. It currently says 01234 111111 but should be 01234 567890. Can this be changed today?",
  },
  {
    id: 3,
    name: 'Vague Website Request',
    message: 'I need something changed on our website.',
  },
  {
    id: 4,
    name: 'Multiple Changes',
    message: 'We need the staff photo changed on the team page and the opening hours updated on the contact page.',
  },
  {
    id: 5,
    name: 'Non-Website Request',
    message: "My property isn't showing on Rightmove.",
  },
  {
    id: 6,
    name: 'Ambiguous Website Problem',
    message: 'Something is wrong with our website.',
  },
  {
    id: 7,
    name: 'Human Escalation Preference',
    message: "I don't want to use the bot, I just need someone to update our homepage.",
  },
];

async function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runEval() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const results = [];

  // First: capture initial portal load (home page)
  console.log('=== PORTAL INITIAL LOAD ===');
  const homePage = await browser.newPage();
  await homePage.setViewport({ width: 1280, height: 900 });

  try {
    await homePage.goto(PORTAL, { waitUntil: 'networkidle2', timeout: 15000 });
  } catch (e) {
    console.log('Navigation timeout (may be OK for SPA):', e.message);
    await delay(3000);
  }

  await delay(2000);
  await homePage.screenshot({ path: path.join(OUT, 'portal_home.png'), fullPage: true });

  const homeText = await homePage.evaluate(() => document.body?.innerText || '');
  const homeHTML = await homePage.evaluate(() => document.body?.innerHTML || '');
  console.log('HOME PAGE TEXT:');
  console.log(homeText);
  console.log('---');

  // Check for taxonomy leaks in home page
  const taxonomyWords = ['category', 'subcategory', 'taxonomy', 'routing', 'queue', 'triage', 'classification'];
  const homeLeaks = taxonomyWords.filter(w => homeText.toLowerCase().includes(w));
  console.log('Taxonomy leak check (home):', homeLeaks.length ? homeLeaks.join(', ') : 'CLEAN');

  fs.writeFileSync(path.join(OUT, 'home_text.txt'), homeText);
  fs.writeFileSync(path.join(OUT, 'home_html.txt'), homeHTML);

  await homePage.close();

  // Mobile viewport test
  console.log('\n=== MOBILE VIEWPORT TEST ===');
  const mobilePage = await browser.newPage();
  await mobilePage.setViewport({ width: 375, height: 812 });
  try {
    await mobilePage.goto(PORTAL, { waitUntil: 'networkidle2', timeout: 15000 });
  } catch (e) {
    await delay(3000);
  }
  await delay(2000);
  await mobilePage.screenshot({ path: path.join(OUT, 'portal_mobile.png'), fullPage: true });
  const mobileText = await mobilePage.evaluate(() => document.body?.innerText || '');
  console.log('MOBILE TEXT:');
  console.log(mobileText);
  fs.writeFileSync(path.join(OUT, 'mobile_text.txt'), mobileText);
  await mobilePage.close();

  // Run each scenario
  for (const scenario of scenarios) {
    console.log(`\n=== SCENARIO ${scenario.id}: ${scenario.name} ===`);
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    // Capture console messages and network
    const consoleLogs = [];
    const networkErrors = [];
    page.on('console', msg => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('requestfailed', req => networkErrors.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`));

    try {
      await page.goto(PORTAL, { waitUntil: 'networkidle2', timeout: 15000 });
    } catch (e) {
      await delay(3000);
    }
    await delay(2000);

    // Screenshot before interaction
    await page.screenshot({ path: path.join(OUT, `scenario${scenario.id}_before.png`), fullPage: true });

    const beforeText = await page.evaluate(() => document.body?.innerText || '');

    // Look for chat input, message input, or textarea
    const inputSelectors = [
      'textarea',
      'input[type="text"]',
      'input[placeholder*="message"]',
      'input[placeholder*="Message"]',
      'input[placeholder*="type"]',
      'input[placeholder*="Type"]',
      'input[placeholder*="ask"]',
      'input[placeholder*="describe"]',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '.chat-input',
      '#chat-input',
      '[data-testid="chat-input"]',
    ];

    let inputFound = null;
    for (const sel of inputSelectors) {
      const el = await page.$(sel);
      if (el) {
        const visible = await el.isIntersectingViewport();
        if (visible) {
          inputFound = sel;
          break;
        }
      }
    }

    // Also check for "New Request" / "Get Help" / "Chat" buttons
    const buttons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      return btns.map(b => ({
        text: b.innerText?.trim(),
        ariaLabel: b.getAttribute('aria-label'),
        href: b.getAttribute('href'),
        class: b.className,
      })).filter(b => b.text || b.ariaLabel);
    });

    console.log('Available buttons:', JSON.stringify(buttons.slice(0, 20), null, 2));
    console.log('Input found:', inputFound || 'NONE');
    console.log('Page text (first 800 chars):', beforeText.substring(0, 800));

    // Try to find and click a "New Request" or "Get Help" or chat-related button
    let navigatedToChat = false;
    const chatTriggerPatterns = [
      /new\s*request/i, /get\s*help/i, /chat/i, /contact/i, /support/i,
      /raise/i, /submit/i, /ask/i, /tell\s*us/i, /describe/i, /start/i,
    ];

    if (!inputFound) {
      for (const btn of buttons) {
        const text = btn.text || btn.ariaLabel || '';
        if (chatTriggerPatterns.some(p => p.test(text))) {
          console.log(`Clicking button: "${text}"`);
          try {
            await page.evaluate((btnText) => {
              const allBtns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
              const target = allBtns.find(b => (b.innerText?.trim() || b.getAttribute('aria-label') || '') === btnText);
              if (target) target.click();
            }, btn.text || btn.ariaLabel);
            await delay(2000);
            navigatedToChat = true;

            // Re-check for input
            for (const sel of inputSelectors) {
              const el = await page.$(sel);
              if (el) {
                const visible = await el.isIntersectingViewport();
                if (visible) {
                  inputFound = sel;
                  break;
                }
              }
            }
            if (inputFound) break;
          } catch (e) {
            console.log('Button click failed:', e.message);
          }
        }
      }
    }

    // Screenshot after navigation
    if (navigatedToChat) {
      await page.screenshot({ path: path.join(OUT, `scenario${scenario.id}_chat.png`), fullPage: true });
    }

    const chatText = await page.evaluate(() => document.body?.innerText || '');

    // Type message if input found
    if (inputFound) {
      console.log(`Typing message into ${inputFound}...`);
      await page.click(inputFound);
      await page.type(inputFound, scenario.message, { delay: 10 });
      await delay(500);

      // Screenshot with typed message
      await page.screenshot({ path: path.join(OUT, `scenario${scenario.id}_typed.png`), fullPage: true });

      // Try to submit - look for send button or press Enter
      const sendBtn = await page.$('button[type="submit"], button[aria-label*="send"], button[aria-label*="Send"]');
      if (sendBtn) {
        await sendBtn.click();
      } else {
        await page.keyboard.press('Enter');
      }

      // Wait for response
      await delay(4000);

      // Screenshot after submission
      await page.screenshot({ path: path.join(OUT, `scenario${scenario.id}_response.png`), fullPage: true });

      const responseText = await page.evaluate(() => document.body?.innerText || '');
      console.log('RESPONSE TEXT:');
      console.log(responseText);

      // Check for taxonomy leaks in response
      const responseLeaks = taxonomyWords.filter(w => responseText.toLowerCase().includes(w));
      console.log('Taxonomy leak check (response):', responseLeaks.length ? responseLeaks.join(', ') : 'CLEAN');

      // Wait a bit more and check for follow-up
      await delay(3000);
      const followUpText = await page.evaluate(() => document.body?.innerText || '');

      // Screenshot final state
      await page.screenshot({ path: path.join(OUT, `scenario${scenario.id}_final.png`), fullPage: true });

      fs.writeFileSync(path.join(OUT, `scenario${scenario.id}_transcript.txt`),
        `SCENARIO ${scenario.id}: ${scenario.name}\n` +
        `INPUT: ${scenario.message}\n\n` +
        `BEFORE TEXT:\n${beforeText}\n\n` +
        `CHAT TEXT:\n${chatText}\n\n` +
        `RESPONSE TEXT:\n${responseText}\n\n` +
        `FINAL TEXT:\n${followUpText}\n\n` +
        `TAXONOMY LEAKS: ${responseLeaks.join(', ') || 'none'}\n` +
        `CONSOLE LOGS:\n${consoleLogs.join('\n')}\n` +
        `NETWORK ERRORS:\n${networkErrors.join('\n')}\n`
      );

      results.push({
        id: scenario.id,
        name: scenario.name,
        inputFound: true,
        inputSelector: inputFound,
        beforeText: beforeText.substring(0, 500),
        responseText: responseText.substring(0, 1500),
        finalText: followUpText.substring(0, 1500),
        taxonomyLeaks: responseLeaks,
        consoleLogs: consoleLogs.slice(-10),
        networkErrors,
      });
    } else {
      console.log('NO CHAT INPUT FOUND — capturing page state');

      fs.writeFileSync(path.join(OUT, `scenario${scenario.id}_transcript.txt`),
        `SCENARIO ${scenario.id}: ${scenario.name}\n` +
        `INPUT: ${scenario.message}\n\n` +
        `NO CHAT INPUT FOUND\n\n` +
        `PAGE TEXT:\n${chatText || beforeText}\n\n` +
        `BUTTONS:\n${JSON.stringify(buttons, null, 2)}\n\n` +
        `CONSOLE LOGS:\n${consoleLogs.join('\n')}\n` +
        `NETWORK ERRORS:\n${networkErrors.join('\n')}\n`
      );

      results.push({
        id: scenario.id,
        name: scenario.name,
        inputFound: false,
        pageText: (chatText || beforeText).substring(0, 1500),
        buttons: buttons.slice(0, 20),
        taxonomyLeaks: taxonomyWords.filter(w => (chatText || beforeText).toLowerCase().includes(w)),
        consoleLogs: consoleLogs.slice(-10),
        networkErrors,
      });
    }

    await page.close();
  }

  // Write summary JSON
  fs.writeFileSync(path.join(OUT, 'eval_results.json'), JSON.stringify(results, null, 2));

  console.log('\n=== EVALUATION COMPLETE ===');
  console.log(`Results written to ${OUT}`);

  await browser.close();
}

runEval().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
