import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORTAL = 'http://127.0.0.1:5174/portal?codexTestUser=1';
const OUT = 'c:/Users/NickW/Claude/windows automation/daypilot/agent_work/eval_output/v2';

fs.mkdirSync(OUT, { recursive: true });

const scenarios = [
  { id: 1, name: 'Simple Content Change', message: 'Our homepage phone number is wrong. It should be 01234 567890.' },
  { id: 2, name: 'Information-Rich Request', message: 'Our website nurturtest.com has the wrong phone number on the contact page. It currently says 01234 111111 but should be 01234 567890. Can this be changed today?' },
  { id: 3, name: 'Vague Website Request', message: 'I need something changed on our website.' },
  { id: 4, name: 'Multiple Changes', message: 'We need the staff photo changed on the team page and the opening hours updated on the contact page.' },
  { id: 5, name: 'Non-Website Request', message: "My property isn't showing on Rightmove." },
  { id: 6, name: 'Ambiguous Website Problem', message: 'Something is wrong with our website.' },
  { id: 7, name: 'Human Escalation Preference', message: "I don't want to use the bot, I just need someone to update our homepage." },
];

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getVisibleText(page) {
  return page.evaluate(() => document.body?.innerText || '');
}

async function getVisibleButtons(page) {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a[role="button"], [role="button"]'));
    return btns.map(b => ({
      text: (b.innerText || '').trim().substring(0, 120),
      ariaLabel: b.getAttribute('aria-label') || '',
      tag: b.tagName,
    })).filter(b => b.text || b.ariaLabel);
  });
}

async function findChatInput(page) {
  const selectors = ['textarea', 'input[type="text"][placeholder*="message" i]', 'input[placeholder*="type" i]', '[contenteditable="true"]'];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      try {
        const vis = await el.isIntersectingViewport();
        if (vis) return { el, sel };
      } catch {}
    }
  }
  return null;
}

async function clickButtonByText(page, pattern) {
  return page.evaluate((pat) => {
    const re = new RegExp(pat, 'i');
    const btns = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const target = btns.find(b => re.test(b.innerText || '') || re.test(b.getAttribute('aria-label') || ''));
    if (target) { target.click(); return (target.innerText || '').trim().substring(0, 80); }
    return null;
  }, pattern);
}

async function clickOptionCard(page, pattern) {
  return page.evaluate((pat) => {
    const re = new RegExp(pat, 'i');
    const els = Array.from(document.querySelectorAll('button, div, span, a'));
    const target = els.find(el => {
      const text = (el.innerText || '').trim();
      const rect = el.getBoundingClientRect();
      return re.test(text) && rect.width > 50 && rect.height > 20 && rect.width < 500;
    });
    if (target) { target.click(); return (target.innerText || '').trim().substring(0, 80); }
    return null;
  }, pattern);
}

async function runScenario(browser, scenario) {
  const log = [];
  const push = (step, data) => { log.push({ step, ...data }); console.log(`  [${step}] ${JSON.stringify(data).substring(0, 200)}`); };

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // Step 1: Load portal
  try { await page.goto(PORTAL, { waitUntil: 'networkidle2', timeout: 15000 }); } catch { await delay(3000); }
  await delay(2000);

  const homeText = await getVisibleText(page);
  push('home_loaded', { textLength: homeText.length, hasGetHelp: homeText.includes('Get help') });

  // Step 2: Click "Get help"
  const helpClicked = await clickButtonByText(page, 'Get help');
  push('get_help_clicked', { result: helpClicked || 'NOT FOUND' });
  await delay(2000);

  // Step 3: Find and use chat input
  const input = await findChatInput(page);
  if (!input) {
    push('BLOCKED', { reason: 'No chat input found after clicking Get help' });
    await page.screenshot({ path: path.join(OUT, `s${scenario.id}_blocked.png`), fullPage: true });
    await page.close();
    return { scenario, log, blocked: true };
  }

  await input.el.click();
  await input.el.type(scenario.message, { delay: 8 });
  await page.screenshot({ path: path.join(OUT, `s${scenario.id}_01_typed.png`), fullPage: true });

  // Submit
  const sendBtn = await page.$('button[type="submit"]');
  if (sendBtn) { await sendBtn.click(); } else { await page.keyboard.press('Enter'); }
  push('message_sent', { message: scenario.message });
  await delay(4000);

  // Step 4: Capture first response
  await page.screenshot({ path: path.join(OUT, `s${scenario.id}_02_first_response.png`), fullPage: true });
  const firstResponse = await getVisibleText(page);
  const firstButtons = await getVisibleButtons(page);

  // Analyse first response
  const hasCategoryPicker = firstResponse.includes('Which area does this relate to');
  const hasDirectConversation = !hasCategoryPicker;
  const taxonomyWords = ['category', 'subcategory', 'taxonomy', 'routing', 'queue', 'triage', 'classification', 'priority', 'SLA', 'department'];
  const taxonomyLeaks = taxonomyWords.filter(w => firstResponse.toLowerCase().includes(w.toLowerCase()));

  push('first_response', {
    hasCategoryPicker,
    hasDirectConversation,
    taxonomyLeaks: taxonomyLeaks.length ? taxonomyLeaks : 'CLEAN',
    responseExcerpt: firstResponse.split('\n').filter(l => l.trim()).slice(-10).join(' | '),
  });

  // Step 5: If there are clickable option cards/buttons (not nav), interact with the most appropriate one
  const chatAreaButtons = firstButtons.filter(b =>
    !['Sign out', 'Home', 'My Tickets', 'Knowledge Base', 'End conversation', 'New Conversation', 'View all', 'Browse all', 'Need help? Contact us'].includes(b.text.split('\n')[0].trim())
    && !b.text.includes('In Progress')
    && b.text.length > 2
  );
  push('chat_buttons', { count: chatAreaButtons.length, labels: chatAreaButtons.map(b => b.text.split('\n')[0].trim()) });

  // If category picker is present, click the most relevant option for this scenario
  let categoryClicked = null;
  if (hasCategoryPicker) {
    // Determine which category fits
    let targetPattern = 'My Website';
    if (scenario.id === 5) targetPattern = 'Something Else';
    if (scenario.id === 7) targetPattern = 'My Website'; // They mentioned homepage

    categoryClicked = await clickOptionCard(page, targetPattern);
    push('category_selected', { target: targetPattern, result: categoryClicked || 'NOT FOUND' });
    await delay(4000);

    await page.screenshot({ path: path.join(OUT, `s${scenario.id}_03_after_category.png`), fullPage: true });
    const afterCategory = await getVisibleText(page);
    push('after_category', { responseExcerpt: afterCategory.split('\n').filter(l => l.trim()).slice(-8).join(' | ') });

    // Step 6: If there's a follow-up prompt, answer it
    const input2 = await findChatInput(page);
    if (input2 && afterCategory.includes('describe')) {
      // The portal is asking us to re-describe — note this as a regression
      push('re_description_requested', { note: 'Portal asked customer to re-describe after category selection' });

      // Answer anyway to see the full flow
      await input2.el.click();
      await input2.el.type('The phone number on the homepage needs changing to 01234 567890', { delay: 8 });
      const sendBtn2 = await page.$('button[type="submit"]');
      if (sendBtn2) { await sendBtn2.click(); } else { await page.keyboard.press('Enter'); }
      await delay(4000);

      await page.screenshot({ path: path.join(OUT, `s${scenario.id}_04_after_description.png`), fullPage: true });
      const afterDesc = await getVisibleText(page);
      push('after_description', { responseExcerpt: afterDesc.split('\n').filter(l => l.trim()).slice(-8).join(' | ') });

      // Check for confirmation or more questions
      const hasConfirmation = /confirm|submit|review|look(s| ) (right|correct|good)|raise.*request|we.ll.*get/i.test(afterDesc);
      push('confirmation_check', { hasConfirmation });

      // If there's a confirmation, check for a submit/confirm button
      if (hasConfirmation) {
        const confirmBtn = await clickButtonByText(page, 'confirm|submit|yes|looks good|raise');
        push('confirm_clicked', { result: confirmBtn || 'NOT FOUND' });
        await delay(3000);
        await page.screenshot({ path: path.join(OUT, `s${scenario.id}_05_submitted.png`), fullPage: true });
        const afterSubmit = await getVisibleText(page);
        push('after_submit', { responseExcerpt: afterSubmit.split('\n').filter(l => l.trim()).slice(-6).join(' | ') });
      }
    }
  } else {
    // Direct conversational flow — no category picker
    push('conversational_flow', { note: 'Portal engaged directly without category picker' });

    // Check if there are quick-reply buttons or follow-up questions
    const afterButtons = await getVisibleButtons(page);
    const quickReplies = afterButtons.filter(b =>
      !['Sign out', 'Home', 'My Tickets', 'Knowledge Base', 'End conversation', 'New Conversation'].includes(b.text.split('\n')[0].trim())
      && !b.text.includes('In Progress')
    );

    if (quickReplies.length > 0) {
      push('quick_replies', { labels: quickReplies.map(b => b.text.substring(0, 60)) });
      // Click the first relevant one
      if (quickReplies[0]) {
        await clickOptionCard(page, quickReplies[0].text.substring(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        await delay(3000);
        await page.screenshot({ path: path.join(OUT, `s${scenario.id}_03_after_reply.png`), fullPage: true });
        const afterReply = await getVisibleText(page);
        push('after_quick_reply', { responseExcerpt: afterReply.split('\n').filter(l => l.trim()).slice(-8).join(' | ') });
      }
    }

    // Check for follow-up input needed
    const input3 = await findChatInput(page);
    if (input3) {
      // Check what the portal is asking for
      const currentText = await getVisibleText(page);
      const lastAssistantMsg = currentText.split('\n').filter(l => l.trim()).slice(-5).join(' ');
      push('assistant_prompt', { lastMessage: lastAssistantMsg.substring(0, 300) });

      // Respond contextually if it's asking a question
      if (/\?|please|could you|can you|which|what|where/i.test(lastAssistantMsg)) {
        await input3.el.click();
        // Give a relevant answer based on scenario
        const answers = {
          1: 'The homepage at nurturtest.com',
          2: '', // Already provided everything
          3: 'We need to update the phone number on our homepage',
          4: 'Both are on nurturtest.com',
          5: '14 Oak Avenue, Oakley, AB1 2CD',
          6: 'The phone number shown is wrong',
          7: '', // Wants human
        };
        const answer = answers[scenario.id];
        if (answer) {
          await input3.el.type(answer, { delay: 8 });
          const sb = await page.$('button[type="submit"]');
          if (sb) { await sb.click(); } else { await page.keyboard.press('Enter'); }
          await delay(4000);
          await page.screenshot({ path: path.join(OUT, `s${scenario.id}_04_followup.png`), fullPage: true });
          const afterFollowup = await getVisibleText(page);
          push('after_followup', { responseExcerpt: afterFollowup.split('\n').filter(l => l.trim()).slice(-8).join(' | ') });
        }
      }
    }
  }

  // Final state
  await page.screenshot({ path: path.join(OUT, `s${scenario.id}_final.png`), fullPage: true });
  const finalText = await getVisibleText(page);
  const finalTaxonomy = taxonomyWords.filter(w => finalText.toLowerCase().includes(w.toLowerCase()));
  push('final_state', { taxonomyLeaks: finalTaxonomy.length ? finalTaxonomy : 'CLEAN' });

  // Write individual transcript
  fs.writeFileSync(path.join(OUT, `s${scenario.id}_transcript.json`), JSON.stringify({ scenario, log }, null, 2));

  await page.close();
  return { scenario, log, blocked: false, hasCategoryPicker, categoryClicked, consoleErrors };
}

async function runMobileTest(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812 });
  try { await page.goto(PORTAL, { waitUntil: 'networkidle2', timeout: 15000 }); } catch { await delay(3000); }
  await delay(2000);
  await page.screenshot({ path: path.join(OUT, 'mobile_home.png'), fullPage: true });
  const text = await getVisibleText(page);

  // Navigate to chat
  await clickButtonByText(page, 'Get help');
  await delay(2000);
  const inp = await findChatInput(page);
  if (inp) {
    await inp.el.click();
    await inp.el.type('I need to update our website phone number', { delay: 8 });
    const sb = await page.$('button[type="submit"]');
    if (sb) { await sb.click(); } else { await page.keyboard.press('Enter'); }
    await delay(3000);
  }
  await page.screenshot({ path: path.join(OUT, 'mobile_chat.png'), fullPage: true });
  const mobileChat = await getVisibleText(page);

  await page.close();
  return { homeText: text, chatText: mobileChat };
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  console.log('=== WORKSTREAM 1 PHASE 1 — ITERATION 2 EVALUATION ===\n');

  const results = [];
  for (const scenario of scenarios) {
    console.log(`\n--- Scenario ${scenario.id}: ${scenario.name} ---`);
    const result = await runScenario(browser, scenario);
    results.push(result);
  }

  console.log('\n--- Mobile Test ---');
  const mobile = await runMobileTest(browser);

  // Write combined results
  fs.writeFileSync(path.join(OUT, 'all_results.json'), JSON.stringify({ results, mobile }, null, 2));

  console.log('\n=== EVALUATION COMPLETE ===');
  console.log(`Results in: ${OUT}`);

  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
