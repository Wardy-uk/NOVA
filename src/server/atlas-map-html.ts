/**
 * System Atlas + System Map wallboard HTML.
 *
 * Source: repo-root nova-atlas.html / nova-map.html (self-contained, no external deps).
 * Embedded as plain template strings so they ship in the build (no runtime file reads),
 * matching the other server-rendered wallboards in index.ts.
 *
 * ATLAS_HTML carries {{AUTONOMY}} / {{TICKETS}} / {{ACTIONS}} placeholders that
 * renderAtlasWallboard() in index.ts fills with live agent-status values.
 *
 * To regenerate after editing the source HTML, re-run the generator in the SNAG prompt.
 */

export const ATLAS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>N.O.V.A — System Atlas</title>
<style>
  :root{
    --bg:#05070f; --bg2:#0a0f1e; --panel:rgba(18,26,46,.72); --line:rgba(120,150,220,.14);
    --txt:#e7eefc; --mut:#8595bd;
    --users:#3fe8e0; --surf:#56d6a4; --brain:#9a8bff; --eng:#f3a94e; --found:#6f8fd6;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:var(--bg);color:var(--txt);font-family:"Segoe UI",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased;overflow-x:hidden}
  #bgfx{position:fixed;inset:0;z-index:0}
  .wrap{position:relative;z-index:1;max-width:1320px;margin:0 auto;padding:30px 26px 90px}

  header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;
    padding-bottom:22px;border-bottom:1px solid var(--line);margin-bottom:8px;flex-wrap:wrap}
  .brand{font-weight:200;font-size:clamp(40px,7vw,78px);letter-spacing:.16em;line-height:.9;
    background:linear-gradient(95deg,#fff,var(--users) 55%,var(--brain));
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .kicker{font:500 11px/1 "Consolas",monospace;letter-spacing:.34em;color:var(--users);
    text-transform:uppercase;margin-bottom:12px}
  .lede{margin-top:14px;max-width:52ch;font-weight:300;font-size:clamp(14px,1.6vw,18px);
    color:var(--mut);line-height:1.55}
  .lede b{color:var(--txt);font-weight:500}
  .metrics{display:flex;gap:22px;flex-wrap:wrap}
  .metric{text-align:right}
  .metric .n{font-weight:200;font-size:30px;letter-spacing:.02em;
    background:linear-gradient(90deg,var(--users),var(--brain));
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .metric .l{font:500 10px/1.4 "Consolas",monospace;letter-spacing:.18em;color:var(--mut);text-transform:uppercase}
  .live{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--surf);
    box-shadow:0 0 10px var(--surf);margin-right:6px;animation:bl 1.6s infinite}
  @keyframes bl{0%,100%{opacity:1}50%{opacity:.25}}

  .controls{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0 8px}
  .pill{font:500 12px/1 "Segoe UI";color:var(--mut);cursor:pointer;
    padding:8px 14px;border:1px solid var(--line);border-radius:30px;background:rgba(255,255,255,.02);
    transition:.18s;user-select:none}
  .pill:hover{color:var(--txt);border-color:rgba(150,180,255,.4)}
  .pill.on{color:#07101e;background:var(--txt);border-color:transparent;font-weight:500}

  .band{position:relative;margin-top:18px;padding:18px 18px 20px 124px;border-radius:16px;
    background:var(--panel);border:1px solid var(--line);backdrop-filter:blur(6px);
    transition:opacity .25s,filter .25s}
  .band.dim{opacity:.2;filter:saturate(.4)}
  .blabel{position:absolute;left:18px;top:18px;width:92px}
  .blabel .bt{font-weight:500;font-size:14px}
  .blabel .bd{margin-top:5px;font:400 11px/1.45 "Segoe UI";color:var(--mut)}

  .row{display:flex;flex-wrap:wrap;gap:9px}
  .node{position:relative;cursor:pointer;padding:9px 13px;border-radius:10px;
    background:rgba(255,255,255,.025);border:1px solid var(--line);border-left-width:3px;
    font-size:13px;color:var(--txt);transition:.16s;display:flex;align-items:center;gap:8px;white-space:nowrap}
  .node:hover{transform:translateY(-2px);background:rgba(255,255,255,.06)}
  .node>.nm{color:var(--txt)}
  .node .tag{font:500 9px/1 "Consolas",monospace;letter-spacing:.1em;color:var(--mut);
    text-transform:uppercase;opacity:.8}
  .node.hot{box-shadow:0 0 0 1px currentColor, 0 0 22px -4px currentColor}

  .brainwrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
  .sub{border:1px dashed rgba(154,139,255,.28);border-radius:12px;padding:11px 11px 13px}
  .sub h4{font:500 11px/1 "Consolas",monospace;letter-spacing:.14em;color:var(--brain);
    text-transform:uppercase;margin-bottom:10px}
  .sub .row{gap:7px}
  .sub .node{font-size:12px;padding:7px 10px}

  .flow{height:24px;display:flex;justify-content:center;align-items:center;pointer-events:none}
  .chev{stroke:var(--line);stroke-width:1.4;fill:none}

  .scrim{position:fixed;inset:0;background:rgba(2,4,10,.55);z-index:20;opacity:0;
    pointer-events:none;transition:.22s;backdrop-filter:blur(2px)}
  .scrim.open{opacity:1;pointer-events:auto}
  .drawer{position:fixed;top:0;right:0;height:100%;width:min(420px,92vw);z-index:21;
    background:linear-gradient(180deg,#0c1326,#070b16);border-left:1px solid var(--line);
    transform:translateX(100%);transition:.28s cubic-bezier(.4,.1,.2,1);
    padding:32px 28px;overflow-y:auto;box-shadow:-30px 0 60px -30px rgba(0,0,0,.8)}
  .drawer.open{transform:translateX(0)}
  .dchip{display:inline-block;font:500 10px/1 "Consolas",monospace;letter-spacing:.16em;
    text-transform:uppercase;padding:6px 11px;border-radius:20px;margin-bottom:16px}
  .drawer h2{font-weight:300;font-size:27px;line-height:1.1}
  .dsec{margin-top:22px}
  .dsec .h{font:500 11px/1 "Consolas",monospace;letter-spacing:.2em;text-transform:uppercase;
    color:var(--mut);margin-bottom:7px;display:flex;align-items:center;gap:8px}
  .dsec .h::before{content:"";width:14px;height:1px;background:currentColor}
  .dsec p{font-weight:300;font-size:15px;line-height:1.6}
  .dclose{position:absolute;top:22px;right:24px;cursor:pointer;color:var(--mut);font-size:22px;
    width:34px;height:34px;border:1px solid var(--line);border-radius:50%;display:grid;place-items:center;transition:.16s}
  .dclose:hover{color:var(--txt);border-color:var(--mut)}
  .hint{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);z-index:5;
    font:400 12px/1 "Segoe UI";color:var(--mut);background:var(--panel);border:1px solid var(--line);
    padding:9px 16px;border-radius:30px;backdrop-filter:blur(6px)}
  .hint b{color:var(--txt);font-weight:500}
</style>
</head>
<body>
<canvas id="bgfx"></canvas>
<div class="wrap">
  <header>
    <div>
      <div class="kicker">Nurtur operational virtual assistant</div>
      <div class="brand">N.O.V.A</div>
      <div class="lede">One operational mind wired into the entire support organisation. It
        <b>perceives</b> every signal, <b>reasons</b> with full context, <b>acts</b> autonomously,
        and <b>learns</b> from the outcome — across a hundred-plus cooperating sub-systems.</div>
    </div>
    <div class="metrics">
      <div class="metric"><div class="n"><span class="live"></span>{{AUTONOMY}}</div><div class="l">autonomy mode</div></div>
      <div class="metric"><div class="n">{{TICKETS}}</div><div class="l">tickets processed</div></div>
      <div class="metric"><div class="n">{{ACTIONS}}</div><div class="l">actions today</div></div>
      <div class="metric"><div class="n">100+</div><div class="l">sub-systems</div></div>
    </div>
  </header>

  <div class="controls" id="controls">
    <div class="pill on" data-f="all">Everything</div>
    <div class="pill" data-f="users">Who uses it</div>
    <div class="pill" data-f="surfaces">Where</div>
    <div class="pill" data-f="brain">The AI brain</div>
    <div class="pill" data-f="engines">Engines</div>
    <div class="pill" data-f="foundation">Foundation</div>
    <div class="pill" data-f="flow" id="flowBtn">▸ Trace the flow</div>
  </div>

  <div id="atlas"></div>
</div>

<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer">
  <div class="dclose" id="dclose">×</div>
  <span class="dchip" id="dchip">group</span>
  <h2 id="dtitle">Title</h2>
  <div class="dsec"><div class="h">What it is</div><p id="dwhat"></p></div>
  <div class="dsec"><div class="h">How it works</div><p id="dhow"></p></div>
  <div class="dsec"><div class="h">Why it exists</div><p id="dwhy"></p></div>
</aside>

<div class="hint">Click any part for <b>what · how · why</b> &nbsp;·&nbsp; filter with the pills above</div>

<script>
const C={users:'#3fe8e0',surfaces:'#56d6a4',brain:'#9a8bff',engines:'#f3a94e',foundation:'#6f8fd6'};
const BANDS=[
 {id:'users',title:'Who',desc:'People who rely on NOVA, and how they meet it.',col:C.users},
 {id:'surfaces',title:'Where',desc:'The areas each role works in.',col:C.surfaces},
 {id:'brain',title:'The brain',desc:'100+ cooperating AI sub-systems.',col:C.brain},
 {id:'engines',title:'Engines',desc:'Business logic powering the surfaces.',col:C.engines},
 {id:'foundation',title:'Foundation',desc:'Data and systems it stands on.',col:C.found},
];
const N=(name,tag,what,how,why)=>({name,tag,what,how,why});

const DATA={
 users:[
  N('Head of Support','manager','The whole team run from a single console.','Manager dashboard, checkpoints, MI reports, capacity forecasts and 1-2-1 briefs in one view.','Leadership runs on evidence, not gut feel.'),
  N('2nd line tech','engineer','Engineers working tickets and problems.','Service-desk Kanban, breached view, problem tickets and the knowledge base.','Faster resolution, less reinventing fixes.'),
  N('1st line care','frontline','First contact and triage for customers.','Calyx portal queue plus NOVA writing the first reply and handing off cleanly.','Customers get an instant, accurate first response.'),
  N('Digital design','delivery','The design team delivering to standard.','Dev-review queue and the training / skills matrix.','Quality and capability tracked in one place.'),
  N('Sales & accounts','commercial','The people owning the customer relationship.','CRM, contracts, sales hotbox and Adobe Sign signing.','Keeps support and revenue joined up.'),
  N('Customers','external','The people NOVA ultimately serves.','Self-serve via the Calyx portal, KB articles, portal chat and surveys.','Deflects tickets and captures real sentiment.'),
  N('The floor','ambient','Everyone watching the room react live.','Always-on SLA, KPI and customer-care wallboards.','The whole team moves the moment something breaches.'),
 ],
 surfaces:[
  N('Service Desk','area','The live ticket-working surface.','Dashboard, Kanban, calendar, SLA timers, my-tickets and needs-attention.','Where day-to-day support actually happens.'),
  N('KPI Engine','area','The performance truth layer.','Dashboards, comparison, leaderboard, trends, daily history and breached views.','Makes performance visible and comparable.'),
  N('QA','area','Quality assurance at scale.','Automated call and ticket scoring, deep-dives and trends.','Quality measured on everything, not a sample.'),
  N('Onboarding','area','New-customer go-live tracking.','Delivery, milestones, overdue, calendar and config matrix.','No customer slips through onboarding.'),
  N('Calyx Portal','area','The customer-facing service portal.','Queue, dashboard, playlists, problems, changes, KB, SLOs and major incidents.','Gives customers a self-serve front door.'),
  N('AI Agent Console','area','The cockpit for the autonomous agent.','Dashboard, workspace, coaching, pipelines, learnings, impact, approvals, flagged queue, KB gaps.','Lets humans supervise and tune the AI.'),
  N('Risk & Intelligence','area','Early-warning and cross-team insight.','Account-risk intelligence, cross-functional view, manager dashboard, board MI.','Surfaces churn risk and systemic issues early.'),
  N('CRM & Sales','area','Commercial relationship surface.','CRM, contracts, contract terms, sales hotbox, Adobe Sign.','Keeps revenue and support joined up.'),
  N('Wallboards','area','Ambient status for the floor.','SLA breach, team KPIs, customer care, tech support, key accounts, customer success.','Turns live state into shared awareness.'),
  N('People','area','The team-management surface.','Team workload, agent roster, dev review, capacity.','Balances load and surfaces development.'),
  N('Training','area','Team capability tracking.','Skills matrix, summaries and training signals.','Shows where to develop the team.'),
  N('Surveys','area','Voice-of-customer capture.','Admin design plus a public respond surface.','Closes the loop on how customers feel.'),
  N('Ops & Briefings','area','The daily operating rhythm.','Ops pack, standups, 1-2-1 briefings, backlog kanban.','Everyone starts the day already briefed.'),
  N('Admin & Settings','area','Configuration and governance.','Admin, settings, brand, integrations, background jobs, SSO log, audit.','One place to run and secure the platform.'),
 ],
 brain:{
  'Perception & understanding':[
   N('Perceiver','perceive','Turns a raw ticket and its context into structured signal.','Gathers history, account, KB and SLA state into one frame.','Good decisions need full context, not the last message.'),
   N('Ticket classifier','perceive','Categorises every incoming ticket.','LLM classification into type, area and priority on arrival.','Everything downstream needs a clean category first.'),
   N('Triage tuner','perceive','Keeps triage accurate over time.','Tunes classification thresholds from feedback.','Triage stays sharp as the work changes.'),
   N('Confidence scorer','perceive','Rates how sure the agent is before acting.','Scores each decision high / medium / low.','High-confidence work runs; the rest waits for a human.'),
   N('Customer resolver','perceive','Works out which customer a ticket belongs to.','Infers and resolves the account from ticket signals.','Context and risk only work with the right account.'),
   N('Problem scanner','perceive','Spots recurring issues across many tickets.','Background scan clustering related tickets into problems.','Fixes the cause, not the same symptom forty times.'),
   N('KB-gap detector','perceive','Notices when knowledge is missing.','Flags tickets the KB could not answer into a gap log.','Feeds the engine that writes the missing articles.'),
  ],
  'Cognition & decision':[
   N('Reasoner','decide','Chooses the action for each ticket.','Weighs context and rules to pick respond / close / escalate / assign.','The judgement at the centre of the loop.'),
   N('Assignment engine','decide','Decides who should own a ticket.','Matches tickets to the right agent or team.','Work lands with the person best placed to do it.'),
   N('Queue ranker','decide','Orders the queue by what matters now.','Ranks tickets on urgency, risk and SLA.','The team always works the right thing next.'),
   N('Escalation predictor','decide','Forecasts which tickets will escalate.','Models escalation likelihood from history.','Get ahead of trouble before it lands.'),
   N('Account-risk engine','decide','Scores customers for churn and trouble.','Risk scoring from support, usage and sentiment signals.','Protect the relationships most at risk.'),
   N('Capacity planner','decide','Projects upcoming team workload.','Trends volume against availability.','Plan staffing before the queue bites.'),
   N('Cross-functional intel','decide','Connects signals across teams.','Correlates support, product and delivery data.','See systemic issues no single area would.'),
   N('Suggestion engine','decide','Proposes the next-best actions.','Surfaces suggestions and quick wins to humans.','Turns insight into things people can just do.'),
  ],
  'Action & automation':[
   N('Actor','act','Executes the chosen action on Jira.','Applies the transition, comment or assignment via API.','Turns a decision into a real change in the system.'),
   N('Auto-rules engine','act','Runs named playbooks for known situations.','Rules like smart-plugin-tpj, mwu-tier-2, dedup and auction-house.','Encodes expert moves so they run instantly.'),
   N('First-reply pipeline','act','Writes the conversational first reply.','Drafts a human-sounding reply then hands off to care.','Customers get a fast, accurate first touch.'),
   N('Quick-win executor','act','Acts on the easy, safe wins automatically.','Executes pre-approved quick-win actions.','Clears the trivial so people do the hard part.'),
   N('Chase agent','act','Chases stalled and awaiting-customer tickets.','Logged nudges on tickets going quiet.','Keeps things moving without manual follow-up.'),
   N('SLA manager','act','Acts to prevent breaches.','Tracks every clock and intervenes before the limit.','Protects the numbers customers are promised.'),
   N('Escalation router','act','Routes and logs every escalation.','SOP-002 gate plus an escalation log backfilled from Jira.','Hard issues reach the right people, on the record.'),
   N('Abuse-report handler','act','Processes abuse reports end to end.','Dedicated processor and executor against the external DB.','A sensitive workflow handled consistently.'),
   N('Plugin → TPJ executor','act','Automates the plugin-to-TPJ maintenance flow.','Executes the TPJ maintenance steps.','A fiddly recurring job done reliably.'),
  ],
  'Governance, safety & trust':[
   N('Autonomy engine','govern','Controls how far NOVA may act alone.','Modes from shadow to full, with weekend override.','Trust is dialled up gradually and safely.'),
   N('Guardrails','govern','Blocks unsafe or out-of-policy actions.','Pre-action checks that can veto the actor.','Autonomy without recklessness.'),
   N('Cancellation guardrail','govern','Extra protection around cancellations.','Special checks on product-cancellation actions.','High-stakes moves get extra scrutiny.'),
   N('Golden rules','govern','Hard constraints it can never cross.','A versioned ruleset (gr-pipeline) enforced on every decision.','Some lines are simply not negotiable.'),
   N('Approval queue','govern','The human-in-the-loop gate.','Low-confidence actions wait for a person to approve.','Keeps a human on the consequential calls.'),
   N('Observer / critic','govern','Reviews actions and flags doubts.','Watches the loop and critiques after the fact.','A second mind checks the first one.'),
   N('Flag auto-dismiss','govern','Clears noise from the flag queue.','Auto-dismisses flags that resolve themselves.','Humans only see flags that still matter.'),
   N('PII sanitiser','govern','Strips sensitive data before the LLM.','Redacts PII from prompts and logs.','Privacy protected by default.'),
   N('Hygiene checker','govern','Watches data quality.','Checks for stale, missing or malformed data.','Decisions are only as good as the data.'),
   N('Audit & SSO log','govern','Records who did what.','Audit trail plus SSO login logging.','Accountability across people and the AI.'),
  ],
  'Learning & evaluation':[
   N('Agent loop','learn','The heartbeat that runs every minute.','Ticks through perceive → reason → act → review.','The engine the whole brain runs on.'),
   N('Self-directed learning','learn','NOVA improves itself.','Identifies its own gaps and learns from outcomes.','Gets sharper without waiting to be told.'),
   N('AI learning service','learn','Turns feedback into better behaviour.','Compares its action to the human outcome and adjusts.','Every correction makes the next call better.'),
   N('Triage-tuning feedback','learn','Closes the loop on classification.','Feeds triage corrections back into the classifier.','Triage accuracy compounds over time.'),
   N('Drift detector','learn','Watches for data and behaviour drift.','Tracks drift per call type over time.','Catches the AI quietly going wrong.'),
   N('Eval suite','learn','Scores quality against benchmarks.','Runs evaluation suites and reports results.','A measurable bar for "good enough".'),
   N('Impact measurement','learn','Proves it is actually helping.','Ties actions to outcomes, alerts and incidents.','Value you can point at, not just activity.'),
   N('Incident detector','learn','Spots when something has gone wrong.','Detects incident patterns and raises them.','Problems get caught, not buried.'),
   N('Coach','learn','Coaches the human team from what it sees.','Generates coaching detail and prep from agent data.','Lifts the people, not just the automation.'),
  ],
  'Knowledge & retrieval (RAG)':[
   N('KB article service','knowledge','Manages the knowledge base content.','Creates, drafts and maintains KB articles.','One trusted place for how-to knowledge.'),
   N('Chunker','knowledge','Breaks documents into retrievable pieces.','Splits content into chunks for embedding.','Retrieval works on the right granularity.'),
   N('Embedder','knowledge','Turns knowledge into vectors.','Generates embeddings for semantic search.','Lets NOVA find meaning, not just keywords.'),
   N('Semantic search','knowledge','Finds the most relevant knowledge.','Vector + RAG retrieval over the KB.','Answers grounded in real documentation.'),
   N('KB-gap closure','knowledge','Turns gaps into new articles.','Drafts content for detected knowledge gaps.','Knowledge grows itself from real demand.'),
   N('KB health','knowledge','Keeps the KB trustworthy.','Scores coverage, staleness and quality.','Knowledge people can actually rely on.'),
   N('Confluence sync','knowledge','Publishes to Confluence.','Two-way sync of KB articles to Confluence.','Where finished knowledge lives.'),
   N('Docs sync','knowledge','Pulls in existing documentation.','Syncs from TFS docs and SharePoint.','Existing knowledge feeds the brain too.'),
  ],
  'Generation & assistants':[
   N('LLM router','generate','Routes work across the models.','Chooses between OpenAI and Claude per task, with failover.','Right model for each job, reliably.'),
   N('Prompt loader','generate','Manages the prompts NOVA uses.','Loads and versions prompt templates.','Behaviour you can tune without code.'),
   N('Portal assistant','generate','The customer-facing chat in the portal.','Conversational intake and answers in Calyx.','Customers get help the moment they ask.'),
   N('AI standup','generate','Drafts the daily standup.','Summarises overnight activity into a brief.','Saves the team the daily write-up.'),
   N('Daily briefing','generate','The morning operating brief.','Pulls the day ahead into one summary.','Everyone starts already in the picture.'),
   N('1-2-1 brief writer','generate','Preps each one-to-one.','Pulls a report’s data into talking points.','Better conversations, less prep time.'),
   N('Board MI commentary','generate','Narrates the management numbers.','Writes the story behind the KPI movements.','Numbers with meaning, not just charts.'),
   N('Ops pack','generate','Assembles the operations pack.','Compiles the recurring ops report.','One pull instead of a morning of copy-paste.'),
   N('QA digest','generate','Summarises quality findings.','Digests QA results into a readable view.','Quality trends without reading every score.'),
  ],
  'Runtime & operations':[
   N('Job registry','runtime','Runs the background jobs.','Schedules and tracks recurring tasks.','The clockwork that keeps NOVA ticking.'),
   N('Pipeline monitor','runtime','Watches the data pipelines.','Tracks n8n pipeline health and runs.','Bad data gets caught at the source.'),
   N('Queue monitor','runtime','Watches the live queues.','Polls sources and tracks queue trends.','Early warning on building pressure.'),
   N('Notification engine','runtime','Gets the right message to the right person.','Routes notifications across channels.','Nothing important goes unseen.'),
   N('Alert service','runtime','Raises alerts when thresholds break.','Fires alerts on breaches and incidents.','The team reacts before customers notice.'),
   N('Config service','runtime','Holds the platform settings.','Flat key-value settings store.','Behaviour changes without redeploys.'),
   N('MCP client','runtime','Talks to external tools and servers.','Calls MCP tools across connected servers.','Extends NOVA’s reach beyond its own code.'),
   N('Lifecycle / stale sweep','runtime','Keeps tickets in a sane state.','Defers, ages and sweeps stale work.','The queue reflects reality, not clutter.'),
  ],
 },
 engines:[
  N('KPI pipeline','service','Feeds the performance numbers.','n8n workflows into the techservicesjsm KPI database.','The single source of KPI truth.'),
  N('KPI compute','service','Turns raw data into metrics.','Agent and org-level KPI computation.','Consistent numbers everywhere they appear.'),
  N('QA pipeline','service','Produces quality scores.','Processes calls and tickets into QA results.','Quality data the rest of NOVA reasons on.'),
  N('Calyx SLO engine','service','Enforces customer-portal SLOs.','Tracks service levels in the Calyx DB.','Customer commitments are measured.'),
  N('Calyx email','service','Handles portal email.','Templated email in and out of Calyx.','Consistent customer communication.'),
  N('Milestone workflow','service','Drives onboarding to completion.','Evaluates milestones every few minutes.','Go-lives stay on track automatically.'),
  N('Onboarding orchestrator','service','Coordinates the onboarding journey.','Sequences delivery steps and owners.','Every new customer gets the same standard.'),
  N('Setup orchestrator','service','Stands up new customer setups.','Template-driven provisioning steps.','Consistent, fast instance setup.'),
  N('Template builder','service','Defines reusable setup templates.','Builds the templates the orchestrator runs.','Repeatable setup without rework.'),
  N('Gamification','service','Motivates the team.','Points, streaks and a composite leaderboard.','Performance with a bit of momentum.'),
  N('Jira sync','service','Keeps tickets in step with Jira.','Continuous REST sync and caching.','NOVA and Jira never disagree.'),
  N('SLA timers','service','Counts down every commitment.','Per-ticket SLA clocks and breach detection.','Nothing breaches unnoticed.'),
  N('Survey engine','service','Runs the survey lifecycle.','Designs, sends and collects responses.','Feedback captured systematically.'),
  N('Portal analytics','service','Measures portal usage.','Tracks portal events and behaviour.','Shows whether self-serve is working.'),
  N('People / HR sync','service','Keeps the team roster current.','Syncs people and availability data.','Workload maths stays accurate.'),
  N('Wallboard renderer','service','Paints the floor displays.','Server-rendered stat wallboards with logging.','Live status anyone can glance at.'),
  N('Sync schedulers','service','Keeps everything fresh.','Per-source timers syncing every few minutes.','Data stays current without manual pulls.'),
 ],
 foundation:[
  N('Azure SQL','data','The primary operational store.','MSSQL connection pool behind most features.','The system of record for NOVA.'),
  N('KPI DB (jsm)','data','The KPI warehouse.','Separate pool to techservicesjsm, n8n-populated tables only.','Performance data isolated and safe.'),
  N('Calyx DB','data','The customer-portal store.','A separate SQLite database, never mixed with the main DB.','Portal data stays cleanly partitioned.'),
  N('External DB','data','Abuse and admin queries.','Settings-configured external MSSQL pools.','Special-case data without polluting core.'),
  N('Vector / RAG store','data','Where knowledge lives as meaning.','Embeddings backing semantic search.','Makes the KB searchable by intent.'),
  N('Settings store','data','The platform’s configuration.','File-based key-value settings.','One place that defines how NOVA behaves.'),
  N('n8n pipelines','data','The ingestion backbone.','Workflows that land data into the KPI tables.','Where raw signal becomes usable data.'),
  N('Jira Service Mgmt','integration','The ticketing system of record.','REST + OAuth sync and the agent acting on issues.','NOVA’s main field of action.'),
  N('Dynamics 365','integration','CRM and commercial data.','Direct D365 client.','Joins support to the customer relationship.'),
  N('Business Central','integration','Finance and subscriptions.','BC client and subscription import.','Ties support context to the contract.'),
  N('Azure DevOps','integration','Engineering work tracking.','REST client for boards and items.','Links support issues to dev work.'),
  N('BriefYourMarket','integration','The core product platform.','Direct BYM client.','Context from the product customers use.'),
  N('Confluence','integration','The knowledge-base home.','MCP / REST publishing of KB articles.','Where generated knowledge is published.'),
  N('SharePoint / MS Graph','integration','Documents and Microsoft 365.','SharePoint and Graph sync clients.','Pulls existing docs and M365 data in.'),
  N('Adobe Sign','integration','Contract signing.','Adobe agreement sender.','Closes contracts without leaving NOVA.'),
  N('NEURO bridge','integration','Link to the NEURO app.','Bridge route to Nick’s NEURO service.','Connects NOVA to adjacent tooling.'),
  N('Entra SSO','integration','Identity and access.','JWT + bcrypt with Entra device-code SSO.','Secure single sign-on for the team.'),
  N('OpenAI · Claude','integration','The reasoning engines.','OpenAI and Anthropic via the LLM router.','The intelligence NOVA thinks with.'),
 ],
};

const atlas=document.getElementById('atlas');
function card(n,band){
  const c=C[band];
  const el=document.createElement('div');
  el.className='node';el.style.borderLeftColor=c;el.style.color=c;
  el.innerHTML='<span class="nm">'+n.name+'</span><span class="tag">'+n.tag+'</span>';
  el.onclick=()=>openDrawer(n,band);
  el.addEventListener('mouseenter',()=>el.classList.add('hot'));
  el.addEventListener('mouseleave',()=>el.classList.remove('hot'));
  return el;
}
function buildBand(b){
  const sec=document.createElement('section');
  sec.className='band';sec.dataset.band=b.id;
  sec.innerHTML='<div class="blabel"><div class="bt" style="color:'+b.col+'">'+b.title+
    '</div><div class="bd">'+b.desc+'</div></div>';
  if(b.id==='brain'){
    const bw=document.createElement('div');bw.className='brainwrap';
    for(const [grp,nodes] of Object.entries(DATA.brain)){
      const s=document.createElement('div');s.className='sub';
      s.innerHTML='<h4>'+grp+'</h4>';
      const r=document.createElement('div');r.className='row';
      nodes.forEach(n=>r.appendChild(card(n,'brain')));
      s.appendChild(r);bw.appendChild(s);
    }
    sec.appendChild(bw);
  }else{
    const r=document.createElement('div');r.className='row';
    DATA[b.id].forEach(n=>r.appendChild(card(n,b.id)));
    sec.appendChild(r);
  }
  return sec;
}
BANDS.forEach((b,i)=>{
  atlas.appendChild(buildBand(b));
  if(i<BANDS.length-1){
    const f=document.createElement('div');f.className='flow';
    f.innerHTML='<svg width="40" height="20"><path class="chev" d="M6 3 L20 13 L34 3"/><path class="chev" d="M6 9 L20 19 L34 9" opacity=".5"/></svg>';
    atlas.appendChild(f);
  }
});

const scrim=document.getElementById('scrim'),drawer=document.getElementById('drawer');
function openDrawer(n,band){
  const c=C[band];
  document.getElementById('dtitle').textContent=n.name;
  const chip=document.getElementById('dchip');
  chip.textContent=BANDS.find(b=>b.id===band).title+' · '+n.tag;
  chip.style.background=c+'22';chip.style.color=c;
  document.getElementById('dwhat').textContent=n.what;
  document.getElementById('dhow').textContent=n.how;
  document.getElementById('dwhy').textContent=n.why;
  drawer.style.borderLeftColor=c;
  drawer.classList.add('open');scrim.classList.add('open');
}
function closeDrawer(){drawer.classList.remove('open');scrim.classList.remove('open');}
document.getElementById('dclose').onclick=closeDrawer;
scrim.onclick=closeDrawer;
addEventListener('keydown',e=>{if(e.key==='Escape')closeDrawer();});

const pills=[...document.querySelectorAll('.pill')];
const bands=[...document.querySelectorAll('.band')];
let flowTimer=null;
pills.forEach(p=>p.onclick=()=>{
  const f=p.dataset.f;
  if(f==='flow'){traceFlow();return;}
  clearInterval(flowTimer);
  pills.forEach(q=>q.classList.toggle('on',q===p));
  bands.forEach(s=>s.classList.toggle('dim', f!=='all' && s.dataset.band!==f));
});
function traceFlow(){
  clearInterval(flowTimer);
  pills.forEach(q=>q.classList.remove('on'));
  document.getElementById('flowBtn').classList.add('on');
  let i=0;const order=['users','surfaces','brain','engines','foundation'];
  const step=()=>{
    bands.forEach(s=>s.classList.toggle('dim', s.dataset.band!==order[i]));
    i++;
    if(i>=order.length){clearInterval(flowTimer);
      setTimeout(()=>bands.forEach(s=>s.classList.remove('dim')),700);
      setTimeout(()=>{document.getElementById('flowBtn').classList.remove('on');
        pills[0].classList.add('on');},800);}
  };
  step();flowTimer=setInterval(step,650);
}

const cv=document.getElementById('bgfx'),g=cv.getContext('2d');
let w,h;function rz(){w=cv.width=innerWidth;h=cv.height=innerHeight;}rz();addEventListener('resize',rz);
const ps=[];for(let i=0;i<70;i++)ps.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,
  vy:0.15+Math.random()*0.5,r:Math.random()*1.6+0.3,a:Math.random()*0.5+0.15,
  c:[C.users,C.brain,C.surfaces][i%3]});
function tick(){
  g.clearRect(0,0,w,h);
  const grd=g.createRadialGradient(w*0.5,h*0.1,0,w*0.5,h*0.1,h*1.1);
  grd.addColorStop(0,'#0b1730');grd.addColorStop(.6,'#070b18');grd.addColorStop(1,'#04060d');
  g.fillStyle=grd;g.fillRect(0,0,w,h);
  for(const p of ps){p.y+=p.vy;if(p.y>h){p.y=-4;p.x=Math.random()*w;}
    g.globalAlpha=p.a;g.fillStyle=p.c;g.beginPath();g.arc(p.x,p.y,p.r,0,7);g.fill();}
  g.globalAlpha=1;requestAnimationFrame(tick);
}tick();
</script>
</body>
</html>
`;

export const MAP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>N.O.V.A — System Map</title>
<style>
  :root{--bg:#05070f;--panel:rgba(18,26,46,.78);--line:rgba(120,150,220,.14);
    --txt:#e7eefc;--mut:#8595bd;}
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:var(--bg);color:var(--txt);font-family:"Segoe UI",system-ui,sans-serif;
    -webkit-font-smoothing:antialiased;overflow-x:hidden}
  #bgfx{position:fixed;inset:0;z-index:0}
  .wrap{position:relative;z-index:1;max-width:1340px;margin:0 auto;padding:24px 22px 36px}
  header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;
    padding-bottom:14px;border-bottom:1px solid var(--line)}
  .kicker{font:500 11px/1 "Consolas",monospace;letter-spacing:.32em;color:#3fe8e0;
    text-transform:uppercase;margin-bottom:10px}
  .brand{font-weight:200;font-size:clamp(28px,5vw,50px);letter-spacing:.14em;line-height:.9;
    background:linear-gradient(95deg,#fff,#3fe8e0 55%,#9a8bff);
    -webkit-background-clip:text;background-clip:text;color:transparent}
  .brand small{font-size:.42em;letter-spacing:.12em;color:var(--mut);-webkit-text-fill-color:var(--mut);
    font-weight:400;margin-left:14px}
  #subhead{margin-top:10px;max-width:62ch;font-weight:300;font-size:14.5px;color:var(--mut);line-height:1.5}
  #subhead b{color:var(--txt);font-weight:500}
  .legend{display:flex;gap:13px;flex-wrap:wrap;align-items:center}
  .lg{display:flex;align-items:center;gap:7px;font:500 11px/1 "Consolas",monospace;
    letter-spacing:.06em;color:var(--mut)}
  .lg i{width:18px;height:3px;border-radius:2px;display:inline-block}
  .toolbar{display:flex;align-items:center;gap:12px;margin-top:14px;min-height:34px}
  .back{display:none;align-items:center;gap:8px;cursor:pointer;font:500 12px/1 "Segoe UI";
    color:var(--txt);background:rgba(255,255,255,.04);border:1px solid var(--line);
    padding:8px 14px;border-radius:30px;transition:.16s}
  .back:hover{border-color:rgba(150,180,255,.45)}
  .ctx{display:none;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:var(--mut)}
  .ctx .nm{font-weight:500;font-size:14px;margin-right:2px}
  .ctx .fc{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.04);
    border:1px solid var(--line);border-radius:18px;padding:4px 10px}
  .ctx .fc.in::before{content:"<";color:#3fe8e0}
  .ctx .fc.out::before{content:">";color:#6fe0a0}
  .stage{position:relative;margin-top:6px}
  svg{width:100%;height:auto;display:block;overflow:visible}
  .edge{fill:none;transition:opacity .2s,stroke-width .2s}
  .nodeg{cursor:pointer}
  .nodeg.flat{cursor:default}
  .nrect{transition:opacity .2s,filter .2s}
  .nlabel{font-weight:500;font-size:14px;fill:var(--txt)}
  .nsub{font-size:11px;fill:var(--mut)}
  .ghost .nlabel{fill:var(--mut);font-weight:400}
  .ghost .nsub{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase}
  .nodeg:not(.flat):hover .nrect{filter:brightness(1.3)}
  .dim{opacity:.07!important}
  .dimn{opacity:.18!important}
  .hint{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:5;
    font:400 12px/1 "Segoe UI";color:var(--mut);background:var(--panel);border:1px solid var(--line);
    padding:9px 16px;border-radius:30px;backdrop-filter:blur(6px)}
  .hint b{color:var(--txt);font-weight:500}
</style>
</head>
<body>
<canvas id="bgfx"></canvas>
<div class="wrap">
  <header>
    <div>
      <div class="kicker">how it all pieces together</div>
      <div class="brand">N.O.V.A <small>system map</small></div>
      <div id="subhead">Every cluster is a mini-map of its own parts. Signal flows left to right
        &mdash; from the systems people use, into <b>perception</b>, <b>decision</b> and <b>action</b>,
        gated by governance and fed back into learning. Click any cluster to expand it.</div>
    </div>
    <div class="legend" id="legend"></div>
  </header>
  <div class="toolbar">
    <div class="back" id="back">&larr; back to map</div>
    <div class="ctx" id="ctx"></div>
  </div>
  <div class="stage">
    <svg id="map" viewBox="0 0 1240 720" role="img" aria-label="NOVA system map"></svg>
  </div>
</div>
<div class="hint" id="hint">Each node is a mini-map of its parts &middot; click to expand</div>
<script>
const FLOW={
 signal:{c:'#3fe8e0',l:'signal in'}, decision:{c:'#9a8bff',l:'decision'},
 action:{c:'#b27bff',l:'action'}, output:{c:'#6fe0a0',l:'output'},
 gov:{c:'#f3a94e',l:'governance'}, knowledge:{c:'#56d6a4',l:'knowledge'},
 feedback:{c:'#ff5ca8',l:'feedback'}, substrate:{c:'#5f7bb0',l:'runtime'},
};
const NODES={
 integ:{x:130,y:250,c:'#6f8fd6',label:'Integrations',role:'external systems it reads and acts on',
   parts:['Jira Service Mgmt','Dynamics 365','Business Central','Azure DevOps','BriefYourMarket','Confluence','SharePoint / MS Graph','Adobe Sign','NEURO bridge','Entra SSO','OpenAI Claude']},
 data:{x:130,y:470,c:'#6f8fd6',label:'Data & pipelines',role:'where raw signal becomes stored data',
   parts:['Azure SQL','KPI DB (jsm)','Calyx DB','External DB','Vector / RAG store','Settings store','n8n pipelines']},
 brain:{x:130,y:90,c:'#6f8fd6',label:'AgentBrain',role:'external issue router (Liam / n8n) — attributes tickets to customers',
   parts:['Issue clustering','Cross-customer classifier','Customer attribution','Issue-card webhook','Issue-card store','At-risk inverter','Ticket risk context','Risk API']},
 perc:{x:370,y:300,c:'#3fe8e0',label:'Perception',role:'turns raw input into classified signal',
   parts:['Perceiver','Ticket classifier','Triage tuner','Confidence scorer','Problem scanner','KB-gap detector']},
 cog:{x:600,y:300,c:'#9a8bff',label:'Cognition',role:'decides what should happen',
   parts:['Reasoner','Assignment engine','Queue ranker','Escalation predictor','Capacity planner','Cross-functional intel','Suggestion engine']},
 act:{x:840,y:300,c:'#b27bff',label:'Action',role:'makes the decision real',
   parts:['Actor','Auto-rules engine','First-reply pipeline','Quick-win executor','Chase agent','SLA manager','Escalation router','Abuse handler','Plugin to TPJ']},
 gov:{x:560,y:92,c:'#f3a94e',label:'Governance',role:'decides what it is allowed to do',
   parts:['Autonomy engine','Guardrails','Cancellation guardrail','Golden rules','Approval queue','Observer critic','Flag auto-dismiss','PII sanitiser','Hygiene checker','Audit & SSO log']},
 know:{x:360,y:560,c:'#56d6a4',label:'Knowledge (RAG)',role:'grounds decisions in real knowledge',
   parts:['KB article service','Chunker','Embedder','Semantic search','KB-gap closure','KB health','Confluence sync','Docs sync']},
 learn:{x:600,y:560,c:'#ff5ca8',label:'Learning',role:'turns outcomes into improvement',
   parts:['Agent loop','Self-directed learning','AI learning service','Triage-tuning feedback','Drift detector','Eval suite','Impact measurement','Incident detector','Coach']},
 gen:{x:1080,y:110,c:'#c5b3ff',label:'Generation',role:'writes the human-facing output',
   parts:['LLM router','Prompt loader','Portal assistant','AI standup','Daily briefing','1-2-1 brief writer','Board MI commentary','Ops pack','QA digest']},
 runtime:{x:840,y:560,c:'#5f7bb0',label:'Runtime & ops',role:'the substrate it all runs on',
   parts:['Job registry','Pipeline monitor','Queue monitor','Notification engine','Alert service','Config service','MCP client','Lifecycle sweep']},
 surf:{x:1090,y:380,c:'#6fe0a0',label:'Surfaces',role:'where output lands for people',
   parts:['Service Desk','KPI Engine','QA','Onboarding','Calyx Portal','AI Console','Risk & Intelligence','CRM & Sales','Wallboards','People','Training','Surveys','Ops & Briefings','Admin']},
 users:{x:1090,y:620,c:'#3fe8e0',label:'Users',role:'the people NOVA serves',
   parts:['Head of Support','2nd line tech','1st line care','Digital design','Sales & accounts','Customers','The floor']},
};
const SUBS={
 'Jira Service Mgmt':'ticketing system','Dynamics 365':'CRM data','Business Central':'finance & subs',
 'Azure DevOps':'dev work','BriefYourMarket':'core product','Confluence':'knowledge base',
 'SharePoint / MS Graph':'docs & M365','Adobe Sign':'contract signing','NEURO bridge':'NEURO link',
 'Entra SSO':'identity','OpenAI Claude':'the LLMs',
 'Azure SQL':'primary store','KPI DB (jsm)':'KPI warehouse','Calyx DB':'portal store',
 'External DB':'abuse & admin','Vector / RAG store':'embeddings','Settings store':'configuration','n8n pipelines':'ingestion',
 'Issue clustering':'groups related tickets','Cross-customer classifier':'classifies the issue','Customer attribution':'maps tickets to accounts',
 'Issue-card webhook':'receives issue cards','Issue-card store':'cards, customers, tickets','At-risk inverter':'issues to at-risk customers',
 'Ticket risk context':'flags ticket triage','Risk API':'serves the risk views',
 'Perceiver':'builds the signal','Ticket classifier':'categorises tickets','Triage tuner':'tunes thresholds',
 'Confidence scorer':'rates certainty','Problem scanner':'clusters issues','KB-gap detector':'spots missing docs',
 'Reasoner':'chooses the action','Assignment engine':'picks the owner','Queue ranker':'orders the queue',
 'Escalation predictor':'forecasts escalations','Capacity planner':'projects workload',
 'Cross-functional intel':'connects teams','Suggestion engine':'proposes next steps',
 'Actor':'executes on Jira','Auto-rules engine':'runs playbooks','First-reply pipeline':'writes first reply',
 'Quick-win executor':'clears easy wins','Chase agent':'chases stalled work','SLA manager':'prevents breaches',
 'Escalation router':'routes & logs','Abuse handler':'processes abuse reports','Plugin to TPJ':'automates TPJ flow',
 'Autonomy engine':'sets how far it acts','Guardrails':'blocks unsafe actions','Cancellation guardrail':'guards cancellations',
 'Golden rules':'hard constraints','Approval queue':'human gate','Observer critic':'reviews actions',
 'Flag auto-dismiss':'clears noise','PII sanitiser':'redacts sensitive data','Hygiene checker':'watches data quality','Audit & SSO log':'records everything',
 'KB article service':'manages articles','Chunker':'splits documents','Embedder':'creates vectors',
 'Semantic search':'finds by meaning','KB-gap closure':'drafts missing docs','KB health':'scores coverage',
 'Confluence sync':'publishes out','Docs sync':'pulls docs in',
 'Agent loop':'the heartbeat','Self-directed learning':'improves itself','AI learning service':'feedback to behaviour',
 'Triage-tuning feedback':'corrects triage','Drift detector':'watches for drift','Eval suite':'scores quality',
 'Impact measurement':'measures outcomes','Incident detector':'spots failures','Coach':'coaches the team',
 'LLM router':'routes to models','Prompt loader':'manages prompts','Portal assistant':'customer chat',
 'AI standup':'daily standup','Daily briefing':'morning brief','1-2-1 brief writer':'preps one-to-ones',
 'Board MI commentary':'narrates the numbers','Ops pack':'ops report','QA digest':'quality summary',
 'Job registry':'runs background jobs','Pipeline monitor':'watches pipelines','Queue monitor':'watches queues',
 'Notification engine':'routes messages','Alert service':'raises alerts','Config service':'holds settings',
 'MCP client':'calls external tools','Lifecycle sweep':'ages stale work',
 'Service Desk':'work tickets','KPI Engine':'performance','QA':'quality scoring','Onboarding':'go-lives',
 'Calyx Portal':'customer portal','AI Console':'agent cockpit','Risk & Intelligence':'early warning',
 'CRM & Sales':'commercial','Wallboards':'ambient status','People':'team management','Training':'capability',
 'Surveys':'feedback','Ops & Briefings':'daily rhythm','Admin':'config & security',
 'Head of Support':'runs the team','2nd line tech':'works tickets','1st line care':'first contact',
 'Digital design':'design delivery','Sales & accounts':'owns relationship','Customers':'self-serve','The floor':'watches live',
};
const EDGES=[
 ['integ','perc','signal',-30],['data','perc','signal',30],['perc','cog','signal',0],
 ['brain','perc','signal',-30],['brain','surf','output',150],
 ['cog','act','decision',0],['act','surf','output',-20],['act','integ','action',150],
 ['gov','cog','gov',-20],['gov','act','gov',30],
 ['know','cog','knowledge',-20],['know','gen','knowledge',-200],
 ['cog','gen','decision',-30],['gen','surf','output',30],['surf','users','output',0],
 ['act','learn','feedback',20],['cog','learn','feedback',-30],
 ['learn','perc','feedback',90],['learn','cog','feedback',30],
 ['runtime','cog','substrate',40],['runtime','act','substrate',-30],['runtime','gen','substrate',-90],
 ['users','integ','signal',320],
];
const INTERNAL={
 perc:{type:'flow',edges:[['Perceiver','Ticket classifier'],['Ticket classifier','Confidence scorer'],['Triage tuner','Ticket classifier'],['Perceiver','Problem scanner'],['Perceiver','KB-gap detector']]},
 cog:{type:'flow',edges:[['Queue ranker','Reasoner'],['Escalation predictor','Reasoner'],['Capacity planner','Reasoner'],['Cross-functional intel','Reasoner'],['Reasoner','Assignment engine'],['Reasoner','Suggestion engine']]},
 brain:{type:'flow',edges:[['Issue clustering','Cross-customer classifier'],['Cross-customer classifier','Customer attribution'],['Customer attribution','Issue-card webhook'],['Issue-card webhook','Issue-card store'],['Issue-card store','At-risk inverter'],['Issue-card store','Ticket risk context'],['At-risk inverter','Risk API']]},
 act:{type:'flow',edges:[['Auto-rules engine','Actor'],['First-reply pipeline','Actor'],['Quick-win executor','Actor'],['SLA manager','Actor'],['Chase agent','Actor'],['Escalation router','Actor'],['Abuse handler','Actor'],['Plugin to TPJ','Actor']]},
 gov:{type:'flow',edges:[['Golden rules','Guardrails'],['Autonomy engine','Guardrails'],['PII sanitiser','Guardrails'],['Hygiene checker','Guardrails'],['Cancellation guardrail','Guardrails'],['Guardrails','Approval queue'],['Observer critic','Flag auto-dismiss'],['Approval queue','Audit & SSO log'],['Flag auto-dismiss','Audit & SSO log']]},
 know:{type:'flow',edges:[['Docs sync','KB article service'],['KB-gap closure','KB article service'],['KB health','KB article service'],['KB article service','Chunker'],['Chunker','Embedder'],['Embedder','Semantic search'],['KB article service','Confluence sync']]},
 learn:{type:'flow',edges:[['Agent loop','AI learning service'],['Drift detector','AI learning service'],['Eval suite','AI learning service'],['Incident detector','Impact measurement'],['Impact measurement','AI learning service'],['AI learning service','Self-directed learning'],['AI learning service','Triage-tuning feedback'],['AI learning service','Coach']]},
 gen:{type:'flow',edges:[['Prompt loader','LLM router'],['LLM router','Portal assistant'],['LLM router','AI standup'],['LLM router','Daily briefing'],['LLM router','1-2-1 brief writer'],['LLM router','Board MI commentary'],['LLM router','Ops pack'],['LLM router','QA digest']]},
 runtime:{type:'flow',edges:[['Config service','Job registry'],['Job registry','Pipeline monitor'],['Job registry','Queue monitor'],['Job registry','Lifecycle sweep'],['Pipeline monitor','Alert service'],['Queue monitor','Alert service'],['Alert service','Notification engine']]},
 integ:{type:'grid'}, data:{type:'grid'}, surf:{type:'grid'}, users:{type:'grid'},
};
const NS='http://www.w3.org/2000/svg';
const svg=document.getElementById('map');
function el(t,a){const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e;}
function pathD(a,b,curve){
  const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
  const mx=(a.x+b.x)/2+nx*curve,my=(a.y+b.y)/2+ny*curve;
  return 'M '+a.x+' '+a.y+' Q '+mx+' '+my+' '+b.x+' '+b.y;
}
function nodeW(label){return Math.max(124,Math.min(196,label.length*8.1+28));}
let particles=[],edgeRefs=[],nodeRefs={};
function clearSvg(){while(svg.firstChild)svg.removeChild(svg.firstChild);particles=[];edgeRefs=[];nodeRefs={};}
function addEdges(edges,pos){
  edges.forEach(function(e){
    const a=pos[e.from],b=pos[e.to];if(!a||!b)return;
    const baseW=e.type==='substrate'?1:(e.thin?1.1:1.6);
    const p=el('path',{class:'edge',d:pathD(a,b,e.curve||0),stroke:e.col,
      'stroke-width':baseW,opacity:e.type==='substrate'?.16:(e.thin?.24:.32)});
    if(e.dashed)p.setAttribute('stroke-dasharray','5 6');
    svg.appendChild(p);edgeRefs.push({from:e.from,to:e.to,el:p,type:e.type,baseW:baseW});
  });
  const pf=el('g',{});svg.appendChild(pf);
  edgeRefs.forEach(function(e){
    if(e.type==='substrate')return;
    const len=e.el.getTotalLength();const n=Math.max(2,Math.round(len/130));
    for(let k=0;k<n;k++){const c=el('circle',{r:2.3,fill:e.el.getAttribute('stroke')});
      pf.appendChild(c);particles.push({el:e.el,len:len,off:(k/n)*len,sp:0.8+Math.random()*0.6,dot:c});}
  });
}
function hoverWire(g,id){g.addEventListener('mouseenter',function(){highlight(id);});
  g.addEventListener('mouseleave',clearHi);}
function renderGraph(nodes,edges,opts){
  clearSvg();opts=opts||{};
  const pos={};nodes.forEach(function(n){pos[n.id]=n;});
  addEdges(edges,pos);
  nodes.forEach(function(n){
    if(n.thumb){
      const w=CARDW,h=CARDH,L=n.x-w/2,T=n.y-h/2;
      const g=el('g',{class:'nodeg'});g.dataset.id=n.id;
      g.appendChild(el('rect',{class:'nrect',x:L,y:T,width:w,height:h,rx:12,
        fill:'rgba(10,15,28,.97)',stroke:n.c,'stroke-width':1.3}));
      g.appendChild(el('rect',{x:L,y:T,width:4,height:h,rx:2,fill:n.c}));
      const tt=el('text',{class:'nlabel','text-anchor':'start',x:L+14,y:T+21});tt.textContent=n.label;g.appendChild(tt);
      const ct=el('text',{class:'nsub','text-anchor':'end',x:L+w-12,y:T+21});ct.textContent=n.thumb.count;g.appendChild(ct);
      g.appendChild(n.thumb.group);
      hoverWire(g,n.id);
      if(n.onClick)g.addEventListener('click',n.onClick);
      svg.appendChild(g);nodeRefs[n.id]=g;return;
    }
    const sub=n.sub||'',hasSub=!!sub,h=hasSub?52:44;
    const w=Math.max(nodeW(n.label),hasSub?nodeW(sub):0);
    const g=el('g',{class:'nodeg'+((opts.flat||n.ghost)?' flat':'')+(n.ghost?' ghost':'')});
    g.dataset.id=n.id;
    const rect=el('rect',{class:'nrect',x:n.x-w/2,y:n.y-h/2,width:w,height:h,rx:11,
      fill:n.ghost?'rgba(9,13,24,.7)':'rgba(12,18,34,.94)',stroke:n.c,'stroke-width':n.ghost?1:1.4});
    if(n.ghost)rect.setAttribute('stroke-dasharray','5 5');
    g.appendChild(rect);
    if(!n.ghost)g.appendChild(el('rect',{x:n.x-w/2,y:n.y-h/2,width:4,height:h,rx:2,fill:n.c}));
    const t1=el('text',{class:'nlabel','text-anchor':'middle',x:n.x+2,y:hasSub?n.y-2:n.y+5});
    t1.textContent=n.label;g.appendChild(t1);
    if(hasSub){const t2=el('text',{class:'nsub','text-anchor':'middle',x:n.x+2,y:n.y+15});
      t2.textContent=sub;g.appendChild(t2);}
    hoverWire(g,n.id);
    if(n.onClick)g.addEventListener('click',n.onClick);
    svg.appendChild(g);nodeRefs[n.id]=g;
  });
}
function highlight(id){
  const conn={};conn[id]=1;
  edgeRefs.forEach(function(e){if(e.from===id||e.to===id){conn[e.from]=1;conn[e.to]=1;}});
  edgeRefs.forEach(function(e){const on=(e.from===id||e.to===id);e.el.classList.toggle('dim',!on);
    e.el.setAttribute('stroke-width',on?Math.max(2.4,e.baseW+1):e.baseW);});
  Object.keys(nodeRefs).forEach(function(nid){nodeRefs[nid].classList.toggle('dimn',!conn[nid]);});
}
function clearHi(){
  edgeRefs.forEach(function(e){e.el.classList.remove('dim');e.el.setAttribute('stroke-width',e.baseW);});
  Object.keys(nodeRefs).forEach(function(nid){nodeRefs[nid].classList.remove('dimn');});
}
function animate(){
  for(const pt of particles){pt.off=(pt.off+pt.sp)%pt.len;
    const p=pt.el.getPointAtLength(pt.off);pt.dot.setAttribute('cx',p.x);pt.dot.setAttribute('cy',p.y);
    pt.dot.setAttribute('opacity',pt.el.classList.contains('dim')?0:0.9);}
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
function neighbours(id){
  const ins=[],outs=[];
  EDGES.forEach(function(e){if(e[1]===id)ins.push(e[0]);if(e[0]===id)outs.push(e[1]);});
  return {ins:Array.from(new Set(ins)),outs:Array.from(new Set(outs))};
}
function layeredPositions(parts,edges){
  const adj={},ind={};parts.forEach(function(p){adj[p]=[];ind[p]=0;});
  edges.forEach(function(e){const a=e[0],b=e[1];if(adj[a]&&b in ind){adj[a].push(b);ind[b]++;}});
  const layer={};parts.filter(function(p){return ind[p]===0;}).forEach(function(p){layer[p]=0;});
  const ind2={};parts.forEach(function(p){ind2[p]=ind[p];});
  const queue=parts.filter(function(p){return ind2[p]===0;});
  while(queue.length){const u=queue.shift();adj[u].forEach(function(v){ind2[v]--;
    layer[v]=Math.max(layer[v]||0,(layer[u]||0)+1);if(ind2[v]===0)queue.push(v);});}
  parts.forEach(function(p){if(layer[p]===undefined)layer[p]=0;});
  const groups={};parts.forEach(function(p){(groups[layer[p]]=groups[layer[p]]||[]).push(p);});
  const layers=Object.keys(groups).map(Number).sort(function(a,b){return a-b;});
  const nL=layers.length,x0=330,x1=950,pos={};
  layers.forEach(function(L,li){const col=groups[L];const x=nL>1?x0+(x1-x0)*li/(nL-1):640;
    const gap=Math.min(98,650/Math.max(col.length,1));const y0=380-(col.length-1)*gap/2;
    col.forEach(function(p,i){pos[p]={x:x,y:y0+i*gap};});});
  return pos;
}
function gridPositions(parts){
  let cols=Math.ceil(Math.sqrt(parts.length));if(parts.length>9)cols++;
  const rows=Math.ceil(parts.length/cols);
  const cw=Math.min(232,940/Math.max(cols-1,1)),ch=Math.min(120,560/Math.max(rows-1,1));
  const x0=640-(cols-1)*cw/2,y0=380-(rows-1)*ch/2,pos={};
  parts.forEach(function(p,i){const r=Math.floor(i/cols),c=i%cols;pos[p]={x:x0+c*cw,y:y0+r*ch};});
  return pos;
}
const CARDW=204,CARDH=152;
function miniGroup(id){
  const n0=NODES[id],spec=INTERNAL[id],parts=n0.parts,c=n0.c;
  const pos=spec.type==='flow'?layeredPositions(parts,spec.edges):gridPositions(parts);
  const boxes=parts.map(function(p){return {id:p,x:pos[p].x,y:pos[p].y,w:nodeW(p),h:40};});
  let minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9;
  boxes.forEach(function(b){minx=Math.min(minx,b.x-b.w/2);maxx=Math.max(maxx,b.x+b.w/2);
    miny=Math.min(miny,b.y-b.h/2);maxy=Math.max(maxy,b.y+b.h/2);});
  const bw=Math.max(maxx-minx,1),bh=Math.max(maxy-miny,1);
  const innerW=CARDW-20,innerH=CARDH-44,s=Math.min(innerW/bw,innerH/bh);
  const cx=n0.x,cy=n0.y;
  const ox=cx-CARDW/2+10+(innerW-bw*s)/2-minx*s;
  const oy=cy-CARDH/2+36+(innerH-bh*s)/2-miny*s;
  const G=el('g',{transform:'translate('+ox+','+oy+') scale('+s+')'});
  (spec.type==='flow'?spec.edges:[]).forEach(function(e){const a=pos[e[0]],b=pos[e[1]];if(!a||!b)return;
    const ln=el('path',{d:pathD(a,b,0),fill:'none',stroke:c,'stroke-width':1,opacity:.5});
    ln.setAttribute('vector-effect','non-scaling-stroke');G.appendChild(ln);});
  boxes.forEach(function(b){
    const r=el('rect',{x:b.x-b.w/2,y:b.y-b.h/2,width:b.w,height:b.h,rx:7,fill:'rgba(20,28,48,.97)',stroke:c,'stroke-width':1.3});
    r.setAttribute('vector-effect','non-scaling-stroke');G.appendChild(r);
    const t=el('text',{class:'nlabel','text-anchor':'middle',x:b.x,y:b.y+5});t.textContent=b.id;G.appendChild(t);
  });
  return {group:G,count:parts.length};
}
function showOverview(){
  document.getElementById('back').style.display='none';
  document.getElementById('ctx').style.display='none';
  document.getElementById('subhead').style.display='block';
  document.getElementById('hint').innerHTML='Each node is a mini-map of its parts &nbsp;&middot;&nbsp; <b>click to expand</b>, hover to trace flow';
  const nodes=Object.keys(NODES).map(function(id){const n=NODES[id];
    return {id:id,label:n.label,x:n.x,y:n.y,c:n.c,thumb:miniGroup(id),onClick:function(){showDetail(id);}};});
  const edges=EDGES.map(function(e){return {from:e[0],to:e[1],type:e[2],curve:e[3],col:FLOW[e[2]].c,
      dashed:(e[2]==='feedback'||e[2]==='substrate'||e[2]==='action')};});
  renderGraph(nodes,edges,{});
}
function showDetail(id){
  const n=NODES[id],spec=INTERNAL[id];
  document.getElementById('back').style.display='inline-flex';
  document.getElementById('subhead').style.display='none';
  document.getElementById('hint').innerHTML='Hover a part to isolate its links &nbsp;&middot;&nbsp; <b>back</b> for the full map';
  const nb=neighbours(id),ins=nb.ins,outs=nb.outs;
  const ctx=document.getElementById('ctx');ctx.style.display='flex';
  ctx.innerHTML='<span class="nm" style="color:'+n.c+'">'+n.label+'</span>'+
    '<span>'+n.parts.length+' parts &middot; '+n.role+'</span>'+
    ins.map(function(i){return '<span class="fc in">'+NODES[i].label+'</span>';}).join('')+
    outs.map(function(o){return '<span class="fc out">'+NODES[o].label+'</span>';}).join('');
  const pos=spec.type==='flow'?layeredPositions(n.parts,spec.edges):gridPositions(n.parts);
  const nodes=n.parts.map(function(p){return {id:p,label:p,sub:SUBS[p]||'',x:pos[p].x,y:pos[p].y,c:n.c};});
  let edges=(spec.type==='flow'?spec.edges:[]).map(function(e){return {from:e[0],to:e[1],col:n.c,type:'decision',curve:0};});
  if(spec.type==='flow'){
    const indeg={},outdeg={};n.parts.forEach(function(p){indeg[p]=0;outdeg[p]=0;});
    spec.edges.forEach(function(e){outdeg[e[0]]++;indeg[e[1]]++;});
    const entry=n.parts.filter(function(p){return indeg[p]===0;});
    const exit=n.parts.filter(function(p){return outdeg[p]===0;});
    ins.forEach(function(nc,i){const gy=380-(ins.length-1)*150/2+i*150,gid='in:'+nc;
      nodes.push({id:gid,label:NODES[nc].label,sub:'sends in',x:140,y:gy,c:NODES[nc].c,ghost:true});
      entry.forEach(function(ep){edges.push({from:gid,to:ep,col:FLOW.signal.c,type:'signal',curve:0,thin:true});});});
    outs.forEach(function(nc,i){const gy=380-(outs.length-1)*150/2+i*150,gid='out:'+nc;
      nodes.push({id:gid,label:NODES[nc].label,sub:'receives',x:1140,y:gy,c:NODES[nc].c,ghost:true});
      exit.forEach(function(xp){edges.push({from:xp,to:gid,col:FLOW.output.c,type:'output',curve:0,thin:true});});});
  }
  renderGraph(nodes,edges,{flat:true});
}
document.getElementById('back').onclick=showOverview;
addEventListener('keydown',function(e){if(e.key==='Escape')showOverview();});
const lg=document.getElementById('legend');
['signal','decision','action','knowledge','gov','feedback','output'].forEach(function(k){
  const d=document.createElement('div');d.className='lg';
  d.innerHTML='<i style="background:'+FLOW[k].c+'"></i>'+FLOW[k].l;lg.appendChild(d);});
showOverview();
const cv=document.getElementById('bgfx'),g=cv.getContext('2d');
let w,h;function rz(){w=cv.width=innerWidth;h=cv.height=innerHeight;}rz();addEventListener('resize',rz);
const ps=[];for(let i=0;i<60;i++)ps.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,
  vy:0.12+Math.random()*0.4,r:Math.random()*1.5+0.3,a:Math.random()*0.45+0.12,
  c:['#3fe8e0','#9a8bff','#56d6a4'][i%3]});
function bg(){g.clearRect(0,0,w,h);
  const grd=g.createRadialGradient(w*0.5,h*0.1,0,w*0.5,h*0.1,h*1.1);
  grd.addColorStop(0,'#0b1730');grd.addColorStop(.6,'#070b18');grd.addColorStop(1,'#04060d');
  g.fillStyle=grd;g.fillRect(0,0,w,h);
  for(const p of ps){p.y+=p.vy;if(p.y>h){p.y=-4;p.x=Math.random()*w;}
    g.globalAlpha=p.a;g.fillStyle=p.c;g.beginPath();g.arc(p.x,p.y,p.r,0,7);g.fill();}
  g.globalAlpha=1;requestAnimationFrame(bg);}bg();
</script>
</body>
</html>
`;
