// Archived from src/server/db/queries.ts on 2026-09-19.
// Onboarding matrix + run + milestone query classes. Not compiled (archive/ is outside tsconfig include).

export interface OnboardingTicketGroup {
  id: number; name: string; sort_order: number; active: number;
  display_name: string | null; traffic_light_group: string | null; created_at: string;
}
export interface OnboardingSaleType {
  id: number; name: string; sort_order: number; active: number;
  jira_tickets_required: number; created_at: string;
}
export interface OnboardingCapability {
  id: number; name: string; code: string | null; ticket_group_id: number | null;
  ticket_group_name?: string; sort_order: number; active: number;
  created_at: string; item_count?: number;
}
export interface OnboardingMatrixCell { id: number; sale_type_id: number; capability_id: number; enabled: number; notes: string | null; }
export interface OnboardingCapabilityItem {
  id: number; capability_id: number; name: string; is_bolt_on: number;
  sort_order: number; active: number; created_at: string;
}
export interface ResolvedCapability { capabilityId: number; capabilityName: string; code: string | null; items: string[]; }
export interface ResolvedTicketGroup { ticketGroupId: number | null; ticketGroupName: string; capabilities: ResolvedCapability[]; }

export class OnboardingConfigQueries {
  async getAllTicketGroups(): Promise<OnboardingTicketGroup[]> {
    return query<OnboardingTicketGroup>(`SELECT * FROM onboarding_ticket_groups ORDER BY sort_order, name`);
  }

  async createTicketGroup(name: string, sortOrder?: number): Promise<number> {
    return executeAndGetId(`INSERT INTO onboarding_ticket_groups (name, sort_order) VALUES (?, ?)`, [name, sortOrder ?? 0]);
  }

  async updateTicketGroup(id: number, updates: { name?: string; sort_order?: number; active?: number; display_name?: string | null; traffic_light_group?: string | null }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (updates.display_name !== undefined) { fields.push('display_name = ?'); params.push(updates.display_name); }
    if (updates.traffic_light_group !== undefined) { fields.push('traffic_light_group = ?'); params.push(updates.traffic_light_group); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE onboarding_ticket_groups SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteTicketGroup(id: number): Promise<boolean> {
    await execute(`UPDATE onboarding_capabilities SET ticket_group_id = NULL WHERE ticket_group_id = ?`, [id]);
    await execute(`DELETE FROM onboarding_ticket_groups WHERE id = ?`, [id]);
    return true;
  }

  async getTrafficLightGroups(): Promise<Array<{ tag: string; displayName: string }>> {
    const rows = await query<{ traffic_light_group: string; display_name: string | null }>(
      `SELECT DISTINCT traffic_light_group, display_name FROM onboarding_ticket_groups WHERE traffic_light_group IS NOT NULL AND traffic_light_group != '' ORDER BY traffic_light_group`
    );
    const results: Array<{ tag: string; displayName: string }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!seen.has(row.traffic_light_group)) {
        seen.add(row.traffic_light_group);
        results.push({ tag: row.traffic_light_group, displayName: row.display_name || row.traffic_light_group });
      }
    }
    return results;
  }

  async getAllSaleTypes(): Promise<OnboardingSaleType[]> {
    return query<OnboardingSaleType>(`SELECT * FROM onboarding_sale_types ORDER BY sort_order, name`);
  }

  async createSaleType(name: string, sortOrder?: number, jiraTicketsRequired?: number): Promise<number> {
    return executeAndGetId(
      `INSERT INTO onboarding_sale_types (name, sort_order, jira_tickets_required) VALUES (?, ?, ?)`,
      [name, sortOrder ?? 0, jiraTicketsRequired ?? 0]
    );
  }

  async updateSaleType(id: number, updates: { name?: string; sort_order?: number; active?: number }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE onboarding_sale_types SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteSaleType(id: number): Promise<boolean> {
    await execute(`DELETE FROM onboarding_matrix WHERE sale_type_id = ?`, [id]);
    await execute(`DELETE FROM onboarding_sale_types WHERE id = ?`, [id]);
    return true;
  }

  async getAllCapabilities(): Promise<OnboardingCapability[]> {
    return query<OnboardingCapability>(`
      SELECT c.*, tg.name as ticket_group_name, COUNT(i.id) as item_count
      FROM onboarding_capabilities c
      LEFT JOIN onboarding_ticket_groups tg ON c.ticket_group_id = tg.id
      LEFT JOIN onboarding_capability_items i ON c.id = i.capability_id
      GROUP BY c.id, c.name, c.code, c.ticket_group_id, c.sort_order, c.active, c.created_at, tg.name
      ORDER BY c.sort_order, c.name
    `);
  }

  async createCapability(name: string, code?: string, sortOrder?: number, ticketGroupId?: number): Promise<number> {
    return executeAndGetId(
      `INSERT INTO onboarding_capabilities (name, code, sort_order, ticket_group_id) VALUES (?, ?, ?, ?)`,
      [name, code ?? null, sortOrder ?? 0, ticketGroupId ?? null]
    );
  }

  async updateCapability(id: number, updates: { name?: string; code?: string; sort_order?: number; active?: number; ticket_group_id?: number | null }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.code !== undefined) { fields.push('code = ?'); params.push(updates.code); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (updates.ticket_group_id !== undefined) { fields.push('ticket_group_id = ?'); params.push(updates.ticket_group_id); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE onboarding_capabilities SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteCapability(id: number): Promise<boolean> {
    await execute(`DELETE FROM onboarding_capability_items WHERE capability_id = ?`, [id]);
    await execute(`DELETE FROM onboarding_matrix WHERE capability_id = ?`, [id]);
    await execute(`DELETE FROM onboarding_capabilities WHERE id = ?`, [id]);
    return true;
  }

  async getFullMatrix(): Promise<{ saleTypes: OnboardingSaleType[]; capabilities: OnboardingCapability[]; cells: OnboardingMatrixCell[]; ticketGroups: OnboardingTicketGroup[] }> {
    const [saleTypes, capabilities, ticketGroups, cells] = await Promise.all([
      this.getAllSaleTypes(),
      this.getAllCapabilities(),
      this.getAllTicketGroups(),
      query<OnboardingMatrixCell>(`SELECT * FROM onboarding_matrix`),
    ]);
    return { saleTypes, capabilities, cells, ticketGroups };
  }

  async setMatrixCell(saleTypeId: number, capabilityId: number, enabled: boolean, notes?: string | null): Promise<void> {
    await execute(`
      MERGE INTO onboarding_matrix WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?, ?)) AS source(sale_type_id, capability_id, enabled, notes)
      ON target.sale_type_id = source.sale_type_id AND target.capability_id = source.capability_id
      WHEN MATCHED THEN UPDATE SET enabled = source.enabled, notes = COALESCE(source.notes, target.notes)
      WHEN NOT MATCHED THEN INSERT (sale_type_id, capability_id, enabled, notes) VALUES (source.sale_type_id, source.capability_id, source.enabled, source.notes);
    `, [saleTypeId, capabilityId, enabled ? 1 : 0, notes ?? null]);
  }

  async batchUpdateMatrix(updates: Array<{ sale_type_id: number; capability_id: number; enabled: boolean; notes?: string | null }>): Promise<void> {
    for (const u of updates) {
      await this.setMatrixCell(u.sale_type_id, u.capability_id, u.enabled, u.notes);
    }
  }

  async resolveForSaleType(saleTypeName: string): Promise<ResolvedTicketGroup[]> {
    const st = await queryOne<{ id: number }>(`SELECT id FROM onboarding_sale_types WHERE name = ? AND active = 1`, [saleTypeName]);
    if (!st) return [];

    const caps = await query<Record<string, unknown>>(`
      SELECT c.id, c.name, c.code, c.ticket_group_id, COALESCE(tg.name, c.name) as ticket_group_name, COALESCE(tg.sort_order, c.sort_order) as group_sort
      FROM onboarding_matrix m
      JOIN onboarding_capabilities c ON m.capability_id = c.id
      LEFT JOIN onboarding_ticket_groups tg ON c.ticket_group_id = tg.id
      WHERE m.sale_type_id = ? AND m.enabled = 1 AND c.active = 1
      ORDER BY group_sort, c.sort_order, c.name
    `, [st.id]);

    const groupMap = new Map<string, ResolvedTicketGroup>();
    for (const row of caps) {
      const groupId = row.ticket_group_id as number | null;
      const groupKey = groupId != null ? `g:${groupId}` : `c:${row.id}`;
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, { ticketGroupId: groupId, ticketGroupName: row.ticket_group_name as string, capabilities: [] });
      }
      const items = await query<{ name: string }>(
        `SELECT name FROM onboarding_capability_items WHERE capability_id = ? AND active = 1 ORDER BY sort_order, name`,
        [row.id as number]
      );
      groupMap.get(groupKey)!.capabilities.push({
        capabilityId: row.id as number, capabilityName: row.name as string,
        code: (row.code as string) ?? null, items: items.map(i => i.name),
      });
    }
    return Array.from(groupMap.values());
  }

  async getItemsForCapability(capabilityId: number): Promise<OnboardingCapabilityItem[]> {
    return query<OnboardingCapabilityItem>(
      `SELECT * FROM onboarding_capability_items WHERE capability_id = ? ORDER BY sort_order, name`, [capabilityId]
    );
  }

  async createItem(capabilityId: number, name: string, isBoltOn?: boolean, sortOrder?: number): Promise<number> {
    return executeAndGetId(
      `INSERT INTO onboarding_capability_items (capability_id, name, is_bolt_on, sort_order) VALUES (?, ?, ?, ?)`,
      [capabilityId, name, isBoltOn ? 1 : 0, sortOrder ?? 0]
    );
  }

  async updateItem(id: number, updates: { name?: string; is_bolt_on?: number; sort_order?: number; active?: number }): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.is_bolt_on !== undefined) { fields.push('is_bolt_on = ?'); params.push(updates.is_bolt_on); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (fields.length === 0) return false;
    params.push(id);
    await execute(`UPDATE onboarding_capability_items SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteItem(id: number): Promise<boolean> {
    await execute(`DELETE FROM onboarding_capability_items WHERE id = ?`, [id]);
    return true;
  }

  async clearAll(): Promise<void> {
    await execute(`DELETE FROM onboarding_capability_items`);
    await execute(`DELETE FROM onboarding_matrix`);
    await execute(`DELETE FROM onboarding_capabilities`);
    await execute(`DELETE FROM onboarding_sale_types`);
    await execute(`DELETE FROM onboarding_ticket_groups`);
  }
}

// ─── Onboarding Runs ───────────────────────────────────────���─────────────────

export interface OnboardingRun {
  id: number; onboarding_ref: string; status: 'pending' | 'success' | 'partial' | 'error';
  parent_key: string | null; child_keys: string | null; created_count: number;
  linked_count: number; error_message: string | null; payload: string | null;
  dry_run: number; user_id: number | null; created_at: string; updated_at: string;
}

export class OnboardingRunQueries {
  async getByRef(ref: string): Promise<OnboardingRun | undefined> {
    return queryOne<OnboardingRun>(
      `SELECT TOP 1 * FROM onboarding_runs WHERE onboarding_ref = ? AND status = 'success' ORDER BY created_at DESC`, [ref]
    );
  }

  async getAllByRef(ref: string): Promise<OnboardingRun[]> {
    return query<OnboardingRun>(`SELECT * FROM onboarding_runs WHERE onboarding_ref = ? ORDER BY created_at DESC`, [ref]);
  }

  async getRecent(limit: number = 20): Promise<OnboardingRun[]> {
    return query<OnboardingRun>(`SELECT TOP(?) * FROM onboarding_runs ORDER BY created_at DESC`, [limit]);
  }

  async create(run: { onboarding_ref: string; payload?: string; user_id?: number; dry_run?: boolean }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO onboarding_runs (onboarding_ref, payload, user_id, dry_run) VALUES (?, ?, ?, ?)`,
      [run.onboarding_ref, run.payload ?? null, run.user_id ?? null, run.dry_run ? 1 : 0]
    );
  }

  async update(id: number, updates: Partial<Pick<OnboardingRun, 'status' | 'parent_key' | 'child_keys' | 'created_count' | 'linked_count' | 'error_message'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const [key, val] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      params.push(val ?? null);
    }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE onboarding_runs SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async getMaxRefNumber(prefix: string): Promise<number> {
    const row = await queryOne<{ onboarding_ref: string }>(
      `SELECT TOP 1 onboarding_ref FROM onboarding_runs WHERE onboarding_ref LIKE ? ORDER BY onboarding_ref DESC`,
      [`${prefix}%`]
    );
    if (!row) return 0;
    const numPart = parseInt(row.onboarding_ref.substring(prefix.length), 10);
    return !isNaN(numPart) ? numPart : 0;
  }
}

// ─── Guild/BYM Onboarding Records (backlog #8) ───────────────────────────────


export interface MilestoneTemplate {
  id: number; name: string; day_offset: number; sort_order: number;
  checklist_json: string; lead_days: number; active: number;
  tickets_enabled: number; created_at: string; updated_at: string;
}
export interface DeliveryMilestone {
  id: number; delivery_id: number; template_id: number; template_name: string;
  target_date: string | null; actual_date: string | null; status: string;
  checklist_state_json: string; notes: string | null;
  workflow_task_created: number; workflow_tickets_created: number;
  jira_keys: string | null; assigned_to: number | null;
  created_at: string; updated_at: string;
}
export interface WorkflowReadyMilestone extends DeliveryMilestone {
  lead_days: number; account: string; product: string;
  sale_type: string | null; onboarding_id: string | null; onboarder: string | null;
}

export class MilestoneQueries {
  async getAllTemplates(activeOnly = false): Promise<MilestoneTemplate[]> {
    const sql = activeOnly
      ? `SELECT * FROM milestone_templates WHERE active = 1 ORDER BY sort_order, name`
      : `SELECT * FROM milestone_templates ORDER BY sort_order, name`;
    return query<MilestoneTemplate>(sql);
  }

  async getTemplateById(id: number): Promise<MilestoneTemplate | undefined> {
    return queryOne<MilestoneTemplate>(`SELECT * FROM milestone_templates WHERE id = ?`, [id]);
  }

  async createTemplate(data: { name: string; day_offset: number; sort_order?: number; checklist_json?: string }): Promise<number> {
    return executeAndGetId(
      `INSERT INTO milestone_templates (name, day_offset, sort_order, checklist_json) VALUES (?, ?, ?, ?)`,
      [data.name, data.day_offset, data.sort_order ?? 0, data.checklist_json ?? '[]']
    );
  }

  async updateTemplate(id: number, updates: Partial<Pick<MilestoneTemplate, 'name' | 'day_offset' | 'sort_order' | 'checklist_json' | 'lead_days' | 'active' | 'tickets_enabled'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.name !== undefined) { fields.push('name = ?'); params.push(updates.name); }
    if (updates.day_offset !== undefined) { fields.push('day_offset = ?'); params.push(updates.day_offset); }
    if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); params.push(updates.sort_order); }
    if (updates.checklist_json !== undefined) { fields.push('checklist_json = ?'); params.push(updates.checklist_json); }
    if (updates.lead_days !== undefined) { fields.push('lead_days = ?'); params.push(updates.lead_days); }
    if (updates.active !== undefined) { fields.push('active = ?'); params.push(updates.active); }
    if (updates.tickets_enabled !== undefined) { fields.push('tickets_enabled = ?'); params.push(updates.tickets_enabled); }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE milestone_templates SET ${fields.join(', ')} WHERE id = ?`, params);
    return true;
  }

  async deleteTemplate(id: number): Promise<boolean> {
    await execute(`DELETE FROM milestone_templates WHERE id = ?`, [id]);
    return true;
  }

  async getMatrixOffsets(): Promise<Array<{ sale_type_id: number; template_id: number; day_offset: number }>> {
    return query<{ sale_type_id: number; template_id: number; day_offset: number }>(`SELECT sale_type_id, template_id, day_offset FROM milestone_sale_type_offsets`);
  }

  async setMatrixOffset(saleTypeId: number, templateId: number, dayOffset: number): Promise<void> {
    await execute(`
      MERGE INTO milestone_sale_type_offsets WITH (HOLDLOCK) AS target
      USING (VALUES (?, ?, ?)) AS source(sale_type_id, template_id, day_offset)
      ON target.sale_type_id = source.sale_type_id AND target.template_id = source.template_id
      WHEN MATCHED THEN UPDATE SET day_offset = source.day_offset
      WHEN NOT MATCHED THEN INSERT (sale_type_id, template_id, day_offset) VALUES (source.sale_type_id, source.template_id, source.day_offset);
    `, [saleTypeId, templateId, dayOffset]);
  }

  async batchSetMatrixOffsets(updates: Array<{ sale_type_id: number; template_id: number; day_offset: number }>): Promise<void> {
    for (const u of updates) await this.setMatrixOffset(u.sale_type_id, u.template_id, u.day_offset);
  }

  async deleteMatrixRow(saleTypeId: number): Promise<void> {
    await execute(`DELETE FROM milestone_sale_type_offsets WHERE sale_type_id = ?`, [saleTypeId]);
  }

  async getOffsetsForSaleType(saleTypeName: string): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    const templates = await this.getAllTemplates(true);
    for (const t of templates) result.set(t.id, t.day_offset);
    const rows = await query<{ template_id: number; day_offset: number }>(`
      SELECT mso.template_id, mso.day_offset
      FROM milestone_sale_type_offsets mso
      JOIN onboarding_sale_types ost ON mso.sale_type_id = ost.id
      WHERE ost.name = ? AND ost.active = 1
    `, [saleTypeName]);
    for (const row of rows) result.set(row.template_id, row.day_offset);
    return result;
  }

  async getByDelivery(deliveryId: number): Promise<DeliveryMilestone[]> {
    return query<DeliveryMilestone>(`SELECT * FROM delivery_milestones WHERE delivery_id = ? ORDER BY target_date, template_name`, [deliveryId]);
  }

  async getMilestoneById(id: number): Promise<DeliveryMilestone | undefined> {
    return queryOne<DeliveryMilestone>(`SELECT * FROM delivery_milestones WHERE id = ?`, [id]);
  }

  async createForDelivery(deliveryId: number, startDate: string, saleType?: string): Promise<DeliveryMilestone[]> {
    const templates = await this.getAllTemplates(true);
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return [];
    const saleTypeOffsets = saleType ? await this.getOffsetsForSaleType(saleType) : null;

    for (const tmpl of templates) {
      const dayOffset = saleTypeOffsets?.get(tmpl.id) ?? tmpl.day_offset;
      const target = new Date(start);
      target.setDate(target.getDate() + dayOffset);
      const targetStr = target.toISOString().split('T')[0];
      let stateJson = '[]';
      try {
        const items = JSON.parse(tmpl.checklist_json || '[]');
        if (Array.isArray(items)) stateJson = JSON.stringify(items.map((text: string) => ({ text, checked: false })));
      } catch { /* keep empty */ }
      await execute(
        `INSERT INTO delivery_milestones (delivery_id, template_id, template_name, target_date, checklist_state_json) VALUES (?, ?, ?, ?, ?)`,
        [deliveryId, tmpl.id, tmpl.name, targetStr, stateJson]
      );
    }
    return this.getByDelivery(deliveryId);
  }

  async updateMilestone(id: number, updates: Partial<Pick<DeliveryMilestone, 'status' | 'actual_date' | 'checklist_state_json' | 'notes' | 'target_date' | 'jira_keys' | 'assigned_to'>>): Promise<boolean> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.actual_date !== undefined) { fields.push('actual_date = ?'); params.push(updates.actual_date); }
    if (updates.checklist_state_json !== undefined) { fields.push('checklist_state_json = ?'); params.push(updates.checklist_state_json); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); params.push(updates.notes); }
    if (updates.target_date !== undefined) { fields.push('target_date = ?'); params.push(updates.target_date); }
    if (updates.jira_keys !== undefined) { fields.push('jira_keys = ?'); params.push(updates.jira_keys); }
    if (updates.assigned_to !== undefined) { fields.push('assigned_to = ?'); params.push(updates.assigned_to); }
    if (fields.length === 0) return false;
    fields.push(`updated_at = GETUTCDATE()`);
    params.push(id);
    await execute(`UPDATE delivery_milestones SET ${fields.join(', ')} WHERE id = ?`, params);
    return (await this.getMilestoneById(id)) !== undefined;
  }

  async deleteByDelivery(deliveryId: number): Promise<number> {
    const row = await queryOne<{ c: number }>(`SELECT COUNT(*) as c FROM delivery_milestones WHERE delivery_id = ?`, [deliveryId]);
    const count = row?.c ?? 0;
    await execute(`DELETE FROM delivery_milestones WHERE delivery_id = ?`, [deliveryId]);
    return count;
  }

  async getOverdueSummaryByDelivery(deliveryIds: number[]): Promise<Map<number, { overdueCount: number; totalCount: number; completeCount: number; nextOverdue: string | null }>> {
    const result = new Map<number, { overdueCount: number; totalCount: number; completeCount: number; nextOverdue: string | null }>();
    if (deliveryIds.length === 0) return result;
    const placeholders = deliveryIds.map(() => '?').join(',');
    const rows = await query<Record<string, unknown>>(`
      SELECT delivery_id,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
        SUM(CASE WHEN status != 'complete' AND target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as overdue,
        MIN(CASE WHEN status != 'complete' AND target_date < CAST(GETUTCDATE() AS DATE) THEN template_name END) as next_overdue
      FROM delivery_milestones
      WHERE delivery_id IN (${placeholders})
      GROUP BY delivery_id
    `, deliveryIds);
    for (const row of rows) {
      result.set(row.delivery_id as number, {
        overdueCount: (row.overdue as number) ?? 0, totalCount: (row.total as number) ?? 0,
        completeCount: (row.complete as number) ?? 0, nextOverdue: (row.next_overdue as string) ?? null,
      });
    }
    return result;
  }

  async getAllWithDelivery(): Promise<Array<DeliveryMilestone & { account: string; product: string; onboarding_id: string | null; onboarder: string | null }>> {
    return query<any>(`
      SELECT dm.*, de.account, de.product, de.onboarding_id, de.onboarder
      FROM delivery_milestones dm
      JOIN delivery_entries de ON dm.delivery_id = de.id
      ORDER BY dm.target_date, de.account, dm.template_name
    `);
  }

  async getOverdue(onboarderName?: string): Promise<Array<DeliveryMilestone & { account: string; product: string; onboarding_id: string | null; onboarder: string | null }>> {
    let sql = `
      SELECT dm.*, de.account, de.product, de.onboarding_id, de.onboarder
      FROM delivery_milestones dm
      JOIN delivery_entries de ON dm.delivery_id = de.id
      WHERE dm.status != 'complete'
        AND dm.target_date IS NOT NULL
        AND dm.target_date < CAST(GETUTCDATE() AS DATE)`;
    const params: unknown[] = [];
    if (onboarderName) {
      sql += ` AND LOWER(de.onboarder) LIKE ?`;
      params.push(`%${onboarderName.toLowerCase()}%`);
    }
    sql += ` ORDER BY dm.target_date, de.account, dm.template_name`;
    return query<any>(sql, params);
  }

  async getSummary(): Promise<{ total: number; pending: number; in_progress: number; complete: number; overdue: number }> {
    const row = await queryOne<Record<string, unknown>>(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
        SUM(CASE WHEN status != 'complete' AND target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as overdue
      FROM delivery_milestones
    `);
    if (!row) return { total: 0, pending: 0, in_progress: 0, complete: 0, overdue: 0 };
    return {
      total: (row.total as number) ?? 0, pending: (row.pending as number) ?? 0,
      in_progress: (row.in_progress as number) ?? 0, complete: (row.complete as number) ?? 0,
      overdue: (row.overdue as number) ?? 0,
    };
  }

  async getOverdueDeliveries(): Promise<Array<{
    delivery_id: number; onboarding_id: string | null; account: string; product: string;
    onboarder: string | null; status: string; go_live_date: string | null;
    overdue_count: number; total_count: number; complete_count: number;
    oldest_overdue_name: string; oldest_overdue_date: string;
  }>> {
    return query<any>(`
      SELECT
        de.id as delivery_id, de.onboarding_id, de.account, de.product,
        de.onboarder, de.status, de.go_live_date,
        COUNT(*) as total_count,
        SUM(CASE WHEN dm.status = 'complete' THEN 1 ELSE 0 END) as complete_count,
        SUM(CASE WHEN dm.status != 'complete' AND dm.target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) as overdue_count,
        (SELECT TOP 1 dm2.template_name FROM delivery_milestones dm2
         WHERE dm2.delivery_id = de.id AND dm2.status != 'complete' AND dm2.target_date < CAST(GETUTCDATE() AS DATE)
         ORDER BY dm2.target_date ASC) as oldest_overdue_name,
        (SELECT TOP 1 dm2.target_date FROM delivery_milestones dm2
         WHERE dm2.delivery_id = de.id AND dm2.status != 'complete' AND dm2.target_date < CAST(GETUTCDATE() AS DATE)
         ORDER BY dm2.target_date ASC) as oldest_overdue_date
      FROM delivery_milestones dm
      JOIN delivery_entries de ON dm.delivery_id = de.id
      GROUP BY de.id, de.onboarding_id, de.account, de.product, de.onboarder, de.status, de.go_live_date
      HAVING SUM(CASE WHEN dm.status != 'complete' AND dm.target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) > 0
      ORDER BY SUM(CASE WHEN dm.status != 'complete' AND dm.target_date < CAST(GETUTCDATE() AS DATE) THEN 1 ELSE 0 END) DESC
    `);
  }

  async completeMatchingDeliveries(deliveryStatus: string, product?: string): Promise<{ deliveries: number; milestones: number }> {
    const productClause = product ? ` AND de.product = ?` : '';
    const params: string[] = [deliveryStatus];
    if (product) params.push(product);

    const row = await queryOne<{ deliveries: number; milestones: number }>(`
      SELECT COUNT(DISTINCT de.id) as deliveries, COUNT(dm.id) as milestones
      FROM delivery_milestones dm JOIN delivery_entries de ON dm.delivery_id = de.id
      WHERE LOWER(de.status) = LOWER(?) ${productClause} AND dm.status != 'complete'
    `, params);
    const deliveries = row?.deliveries ?? 0;
    const milestones = row?.milestones ?? 0;
    if (milestones === 0) return { deliveries: 0, milestones: 0 };

    await execute(`
      UPDATE delivery_milestones SET status = 'complete', actual_date = CAST(GETUTCDATE() AS DATE), updated_at = GETUTCDATE()
      WHERE status != 'complete'
        AND delivery_id IN (
          SELECT de.id FROM delivery_entries de WHERE LOWER(de.status) = LOWER(?) ${productClause}
        )
    `, params);
    return { deliveries, milestones };
  }

  async getNextPendingByDelivery(deliveryIds: number[]): Promise<Map<number, { name: string; target_date: string; status: string }>> {
    const result = new Map<number, { name: string; target_date: string; status: string }>();
    if (deliveryIds.length === 0) return result;
    const placeholders = deliveryIds.map(() => '?').join(',');
    const rows = await query<Record<string, unknown>>(`
      SELECT delivery_id, template_name, target_date, status
      FROM delivery_milestones
      WHERE delivery_id IN (${placeholders}) AND status != 'complete'
      ORDER BY target_date ASC
    `, deliveryIds);
    const seen = new Set<number>();
    for (const row of rows) {
      const did = row.delivery_id as number;
      if (seen.has(did)) continue;
      seen.add(did);
      result.set(did, { name: row.template_name as string, target_date: (row.target_date as string) ?? '', status: row.status as string });
    }
    return result;
  }

  async getTemplateTicketGroups(templateId: number): Promise<number[]> {
    const rows = await query<{ ticket_group_id: number }>(
      `SELECT ticket_group_id FROM milestone_template_ticket_groups WHERE template_id = ? ORDER BY ticket_group_id`, [templateId]
    );
    return rows.map(r => r.ticket_group_id);
  }

  async setTemplateTicketGroups(templateId: number, ticketGroupIds: number[]): Promise<void> {
    await execute(`DELETE FROM milestone_template_ticket_groups WHERE template_id = ?`, [templateId]);
    for (const gid of ticketGroupIds) {
      await execute(`INSERT INTO milestone_template_ticket_groups (template_id, ticket_group_id) VALUES (?, ?)`, [templateId, gid]);
    }
  }

  async getAllTemplateTicketGroupMappings(): Promise<Array<{ template_id: number; ticket_group_id: number }>> {
    return query<{ template_id: number; ticket_group_id: number }>(`SELECT template_id, ticket_group_id FROM milestone_template_ticket_groups`);
  }

  async getMilestonesReadyForWorkflow(): Promise<WorkflowReadyMilestone[]> {
    return query<WorkflowReadyMilestone>(`
      SELECT dm.*, mt.lead_days, de.account, de.product, de.sale_type, de.onboarding_id, de.onboarder
      FROM delivery_milestones dm
      JOIN milestone_templates mt ON dm.template_id = mt.id
      JOIN delivery_entries de ON dm.delivery_id = de.id
      WHERE dm.status != 'complete'
        AND dm.workflow_task_created = 0
        AND dm.target_date IS NOT NULL
        AND DATEADD(day, -COALESCE(mt.lead_days, 3), dm.target_date) <= CAST(GETUTCDATE() AS DATE)
      ORDER BY dm.target_date ASC
    `);
  }

  async markWorkflowTaskCreated(milestoneId: number): Promise<void> {
    await execute(`UPDATE delivery_milestones SET workflow_task_created = 1, updated_at = GETUTCDATE() WHERE id = ?`, [milestoneId]);
  }

  async markWorkflowTicketsCreated(milestoneId: number, jiraKeys: string[]): Promise<void> {
    await execute(
      `UPDATE delivery_milestones SET workflow_tickets_created = 1, jira_keys = ?, updated_at = GETUTCDATE() WHERE id = ?`,
      [JSON.stringify(jiraKeys), milestoneId]
    );
  }

  async getNextMilestoneForDelivery(deliveryId: number, afterTemplateId: number): Promise<(DeliveryMilestone & { lead_days: number }) | undefined> {
    return queryOne<DeliveryMilestone & { lead_days: number }>(`
      SELECT TOP 1 dm.*, mt.lead_days
      FROM delivery_milestones dm
      JOIN milestone_templates mt ON dm.template_id = mt.id
      WHERE dm.delivery_id = ? AND dm.status != 'complete' AND dm.workflow_task_created = 0
        AND mt.sort_order > (SELECT sort_order FROM milestone_templates WHERE id = ?)
      ORDER BY mt.sort_order ASC
    `, [deliveryId, afterTemplateId]);
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

