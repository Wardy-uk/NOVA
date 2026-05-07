export const TEAM_AGENTS = [
    'Naomi Wentworth', 'Nick Ward', 'Heidi Power', 'Sebastian Broome',
    'Nathan Rutland', 'Isabel Busk', 'Arman Shazad', 'Zoe Rees',
    'Kayleigh Russell', 'Hope Goodall', 'Abdi Mohamed', 'Willem Kruger',
    'Stephen Mitchell', 'Luke Scaife',
];
/** Allowed tables — every query must only touch these */
export const ALLOWED_TABLES = [
    'dbo.jira_kpi_daily',
    'dbo.KpiSnapshot',
    'dbo.jira_agent_kpi_daily',
    'dbo.jira_qa_results',
    'dbo.Jira_QA_GoldenRules',
    'dbo.Agent',
];
/** TierCode → display name mapping */
export const TIER_MAP = {
    T1: 'Customer Care',
    NTL: 'Production',
    TPJM: 'Production',
    T2: 'Tier 2',
};
/** Checkpoint date anchors */
export const CHECKPOINT_DATES = {
    day0: '2026-03-02',
    day1: '2026-03-16',
    day15: '2026-03-31',
    day30: '2026-04-15',
};
//# sourceMappingURL=constants.js.map