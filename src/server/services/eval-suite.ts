import { query, executeAndGetId } from './database.js';
import type { LlmService } from './llm-service.js';
import type { SettingsQueries } from '../db/settings-store.js';
import type { KbSearchService } from './kb-search.js';
import { TriageResultSchema, type TriageResult } from './triage-schema.js';
import { loadPrompt } from './prompt-loader.js';

interface EvalDecisionRow {
  id: number;
  ticket_id: string;
  event_type: string;
  inputs: string;
  reasoning: string;
  output: string;
  action: string;
  confidence: number;
  eval_label: string;
  prompt_version: string | null;
  model: string | null;
}

interface EvalDecisionResult {
  decisionId: number;
  ticketId: string;
  originalAction: string;
  newAction: string;
  originalLabel: string;
  matched: boolean;
  reason: string;
}

export interface EvalResult {
  total: number;
  matched: number;
  accept_rate: number;
  baseline_rate: number;
  delta: number;
  failures: EvalDecisionResult[];
  details: EvalDecisionResult[];
}

export interface ReplayResult extends EvalResult {
  changes: Array<{ decisionId: number; ticketId: string; originalAction: string; newAction: string; changed: boolean; reason: string }>;
  changeSummary: Record<string, number>;
}

export class EvalSuite {
  private llmService: LlmService;
  private settings: SettingsQueries;
  private kbSearch: KbSearchService;

  constructor(llmService: LlmService, settings: SettingsQueries, kbSearch: KbSearchService) {
    this.llmService = llmService;
    this.settings = settings;
    this.kbSearch = kbSearch;
  }

  async runEval(options: {
    sampleSize: number;
    promptOverride?: string;
    modelOverride?: string;
    runBy?: string;
  }): Promise<EvalResult> {
    const labelled = await query<EvalDecisionRow>(
      `SELECT TOP (${options.sampleSize}) id, ticket_id, event_type, inputs, reasoning, output, action, confidence, eval_label, prompt_version, model
       FROM agent_decisions
       WHERE eval_label IN ('correct', 'incorrect')
         AND event_type != 'backfill'
       ORDER BY NEWID()`,
    );

    if (labelled.length === 0) {
      return { total: 0, matched: 0, accept_rate: 0, baseline_rate: 0, delta: 0, failures: [], details: [] };
    }

    const baselineCorrect = labelled.filter(d => d.eval_label === 'correct').length;
    const baselineRate = (baselineCorrect / labelled.length) * 100;

    const details: EvalDecisionResult[] = [];
    let matched = 0;

    for (const row of labelled) {
      try {
        const inputs = JSON.parse(row.inputs);
        const kbMatches = await this.kbSearch.search(`${inputs.summary ?? ''} ${(inputs.description ?? '').slice(0, 200)}`);
        const kbText = this.kbSearch.formatForPrompt(kbMatches);

        const systemPrompt = options.promptOverride ?? loadPrompt('triage', {
          ticket_key: row.ticket_id,
          summary: inputs.summary ?? '',
          description: inputs.description ?? '(no description)',
          request_type: inputs.requestType ?? 'Not specified',
          priority: inputs.priority ?? 'Medium',
          reporter: inputs.reporter ?? 'Unknown',
          organisation: inputs.organisation ?? 'Unknown',
          created: inputs.created ?? '',
          customer_context: 'No additional customer context available.',
          kb_matches: kbText,
          learnings: 'No prior learnings available.',
        });

        const result = await this.llmService.call<TriageResult>(
          systemPrompt,
          'Analyse this ticket and produce the structured JSON assessment.',
          TriageResultSchema,
          {
            ticketId: row.ticket_id,
            callType: 'eval',
            temperature: 0.2,
            ...(options.modelOverride ? { modelOverride: options.modelOverride } : {}),
          },
        );

        const newAction = result.data.recommended_action;
        const originalOutput = JSON.parse(row.output);
        const originalAction = originalOutput.recommended_action ?? row.action;

        const isMatch = row.eval_label === 'correct'
          ? newAction === originalAction
          : newAction !== originalAction;

        if (isMatch) matched++;

        const detail: EvalDecisionResult = {
          decisionId: row.id,
          ticketId: row.ticket_id,
          originalAction,
          newAction,
          originalLabel: row.eval_label,
          matched: isMatch,
          reason: isMatch ? 'Matched expected outcome' : `Expected ${row.eval_label === 'correct' ? 'same' : 'different'} action, got ${newAction}`,
        };
        details.push(detail);
      } catch (err) {
        details.push({
          decisionId: row.id,
          ticketId: row.ticket_id,
          originalAction: row.action,
          newAction: 'error',
          originalLabel: row.eval_label,
          matched: false,
          reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    const acceptRate = (matched / labelled.length) * 100;
    const delta = acceptRate - baselineRate;

    await executeAndGetId(
      `INSERT INTO agent_eval_runs (run_type, sample_size, matched, accept_rate, baseline_rate, delta, prompt_version, model_override, details, run_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['eval', labelled.length, matched, acceptRate, baselineRate, delta,
        options.promptOverride ? 'custom' : null, options.modelOverride ?? null,
        JSON.stringify(details), options.runBy ?? null],
    );

    return {
      total: labelled.length,
      matched,
      accept_rate: Math.round(acceptRate * 100) / 100,
      baseline_rate: Math.round(baselineRate * 100) / 100,
      delta: Math.round(delta * 100) / 100,
      failures: details.filter(d => !d.matched),
      details,
    };
  }

  async runReplay(options: {
    sampleSize: number;
    promptOverride?: string;
    modelOverride?: string;
    runBy?: string;
  }): Promise<ReplayResult> {
    const sample = await query<EvalDecisionRow>(
      `SELECT TOP (${options.sampleSize}) id, ticket_id, event_type, inputs, reasoning, output, action, confidence, COALESCE(eval_label, 'unlabelled') as eval_label, prompt_version, model
       FROM agent_decisions
       WHERE event_type != 'backfill'
       ORDER BY NEWID()`,
    );

    if (sample.length === 0) {
      return { total: 0, matched: 0, accept_rate: 0, baseline_rate: 0, delta: 0, failures: [], details: [], changes: [], changeSummary: {} };
    }

    const details: EvalDecisionResult[] = [];
    const changes: ReplayResult['changes'] = [];
    const changeSummary: Record<string, number> = {};
    let matched = 0;

    for (const row of sample) {
      try {
        const inputs = JSON.parse(row.inputs);
        const kbMatches = await this.kbSearch.search(`${inputs.summary ?? ''} ${(inputs.description ?? '').slice(0, 200)}`);
        const kbText = this.kbSearch.formatForPrompt(kbMatches);

        const systemPrompt = options.promptOverride ?? loadPrompt('triage', {
          ticket_key: row.ticket_id,
          summary: inputs.summary ?? '',
          description: inputs.description ?? '(no description)',
          request_type: inputs.requestType ?? 'Not specified',
          priority: inputs.priority ?? 'Medium',
          reporter: inputs.reporter ?? 'Unknown',
          organisation: inputs.organisation ?? 'Unknown',
          created: inputs.created ?? '',
          customer_context: 'No additional customer context available.',
          kb_matches: kbText,
          learnings: 'No prior learnings available.',
        });

        const result = await this.llmService.call<TriageResult>(
          systemPrompt,
          'Analyse this ticket and produce the structured JSON assessment.',
          TriageResultSchema,
          {
            ticketId: row.ticket_id,
            callType: 'replay',
            temperature: 0.2,
            ...(options.modelOverride ? { modelOverride: options.modelOverride } : {}),
          },
        );

        const newAction = result.data.recommended_action;
        const originalOutput = JSON.parse(row.output);
        const originalAction = originalOutput.recommended_action ?? row.action;
        const changed = newAction !== originalAction;
        const isMatch = !changed;

        if (isMatch) matched++;

        if (changed) {
          const key = `${originalAction} → ${newAction}`;
          changeSummary[key] = (changeSummary[key] ?? 0) + 1;
        }

        changes.push({ decisionId: row.id, ticketId: row.ticket_id, originalAction, newAction, changed, reason: changed ? `Action changed from ${originalAction} to ${newAction}` : 'No change' });
        details.push({ decisionId: row.id, ticketId: row.ticket_id, originalAction, newAction, originalLabel: row.eval_label, matched: isMatch, reason: changed ? `Changed: ${originalAction} → ${newAction}` : 'Unchanged' });
      } catch (err) {
        details.push({ decisionId: row.id, ticketId: row.ticket_id, originalAction: row.action, newAction: 'error', originalLabel: row.eval_label, matched: false, reason: `Error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    const acceptRate = (matched / sample.length) * 100;

    await executeAndGetId(
      `INSERT INTO agent_eval_runs (run_type, sample_size, matched, accept_rate, baseline_rate, delta, prompt_version, model_override, details, run_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['replay', sample.length, matched, acceptRate, 0, 0,
        options.promptOverride ? 'custom' : null, options.modelOverride ?? null,
        JSON.stringify({ changes, changeSummary }), options.runBy ?? null],
    );

    return {
      total: sample.length,
      matched,
      accept_rate: Math.round(acceptRate * 100) / 100,
      baseline_rate: 0,
      delta: 0,
      failures: details.filter(d => !d.matched),
      details,
      changes,
      changeSummary,
    };
  }

  async getEvalRuns(limit = 20): Promise<unknown[]> {
    return query(
      `SELECT TOP (${limit}) * FROM agent_eval_runs ORDER BY run_at DESC`,
    );
  }
}
