export declare const TEAM_AGENTS: readonly ["Naomi Wentworth", "Nick Ward", "Heidi Power", "Sebastian Broome", "Nathan Rutland", "Isabel Busk", "Arman Shazad", "Zoe Rees", "Kayleigh Russell", "Hope Goodall", "Abdi Mohamed", "Willem Kruger", "Stephen Mitchell", "Luke Scaife"];
export type TeamAgent = typeof TEAM_AGENTS[number];
/** Allowed tables — every query must only touch these */
export declare const ALLOWED_TABLES: readonly ["dbo.jira_kpi_daily", "dbo.KpiSnapshot", "dbo.jira_agent_kpi_daily", "dbo.jira_qa_results", "dbo.Jira_QA_GoldenRules", "dbo.Agent"];
/** TierCode → display name mapping */
export declare const TIER_MAP: Record<string, string>;
/** Checkpoint date anchors */
export declare const CHECKPOINT_DATES: {
    readonly day0: "2026-03-02";
    readonly day1: "2026-03-16";
    readonly day15: "2026-03-31";
    readonly day30: "2026-04-15";
};
