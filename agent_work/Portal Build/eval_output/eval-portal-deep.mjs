import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORTAL = 'http://127.0.0.1:5174/portal?codexTestUser=1';
const OUT = 'c:/Users/NickW/Claude/windows automation/daypilot/agent_work/eval_output';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runDeepTest() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Navigate to portal
  try {
    await page.goto(PORTAL, { waitUntil: 'networkidle2', timeout: 15000 });
  } catch (e) { await delay(3000); }
  await delay(2000);

  // Click "Get help"
  console.log('=== STEP 1: Click Get help ===');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
    const target = btns.find(b => b.getAttribute('aria-label') === 'Get help from support');
    if (target) target.click();
  });
  await delay(2000);

  // Type Scenario 1 message
  console.log('=== STEP 2: Type message ===');
  const textarea = await page.$('textarea');
  if (textarea) {
    await textarea.click();
    await textarea.type('Our homepage phone number is wrong. It should be 01234 567890.', { delay: 10 });
    await page.keyboard.press('Enter');
    await delay(3000);
  }

  // Capture the category picker state
  await page.screenshot({ path: path.join(OUT, 'deep_01_category_picker.png'), fullPage: true });
  const stateAfterMessage = await page.evaluate(() => document.body?.innerText || '');
  console.log('STATE AFTER MESSAGE:');
  console.log(stateAfterMessage);

  // Now click "My Website" button
  console.log('\n=== STEP 3: Click My Website ===');
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"], div[class*="cursor"]'));
    // Look for button containing "My Website"
    for (const btn of btns) {
      if (btn.innerText?.includes('My Website')) {
        btn.click();
        return btn.innerText;
      }
    }
    // Try broader search
    const allElements = Array.from(document.querySelectorAll('*'));
    for (const el of allElements) {
      if (el.innerText?.trim() === 'My Website' ||
          (el.innerText?.includes('My Website') && el.innerText?.includes('Content updates'))) {
        el.click();
        return 'clicked: ' + el.tagName + ' - ' + el.innerText?.substring(0, 50);
      }
    }
    return 'NOT FOUND';
  });
  console.log('Click result:', clicked);
  await delay(4000);

  await page.screenshot({ path: path.join(OUT, 'deep_02_after_website_click.png'), fullPage: true });
  const stateAfterClick = await page.evaluate(() => document.body?.innerText || '');
  console.log('\nSTATE AFTER MY WEBSITE CLICK:');
  console.log(stateAfterClick);

  // Check if there's a new prompt or follow-up question
  // Look for any new elements that appeared
  const newButtons = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
    return btns.map(b => b.innerText?.trim()).filter(t => t);
  });
  console.log('\nBUTTONS AFTER CLICK:', JSON.stringify(newButtons));

  // If there's a new textarea visible, type additional info
  const textarea2 = await page.$('textarea');
  if (textarea2) {
    const isVisible = await textarea2.isIntersectingViewport();
    console.log('Textarea visible after click:', isVisible);
  }

  // Wait more and check for any follow-up
  await delay(3000);
  await page.screenshot({ path: path.join(OUT, 'deep_03_final_state.png'), fullPage: true });
  const finalState = await page.evaluate(() => document.body?.innerText || '');

  // Check for taxonomy words in the full flow
  const taxonomyWords = ['category', 'subcategory', 'taxonomy', 'routing', 'queue', 'triage',
    'classification', 'priority', 'SLA', 'team', 'department', 'assign', 'escalat'];
  const leaks = taxonomyWords.filter(w => finalState.toLowerCase().includes(w));
  console.log('\nFINAL STATE:');
  console.log(finalState);
  console.log('\nTAXONOMY LEAKS:', leaks.length ? leaks.join(', ') : 'CLEAN');

  // Write full transcript
  fs.writeFileSync(path.join(OUT, 'deep_test_transcript.txt'),
    `DEEP TEST — Full Conversational Flow\n` +
    `=====================================\n\n` +
    `STEP 1 — User message: "Our homepage phone number is wrong. It should be 01234 567890."\n\n` +
    `RESPONSE (category picker):\n${stateAfterMessage}\n\n` +
    `STEP 2 — Clicked "My Website"\n` +
    `Click result: ${clicked}\n\n` +
    `RESPONSE AFTER CLICK:\n${stateAfterClick}\n\n` +
    `FINAL STATE:\n${finalState}\n\n` +
    `TAXONOMY LEAKS: ${leaks.join(', ') || 'none'}\n` +
    `BUTTONS: ${JSON.stringify(newButtons)}\n`
  );

  await browser.close();
  console.log('\nDone.');
}

runDeepTest().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
