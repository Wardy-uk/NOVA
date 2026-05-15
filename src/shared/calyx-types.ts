/* CALYX SHELVED — entire module commented out, restore when needed */

export type TicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'waiting_third_party' | 'resolved' | 'closed';
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type TicketEventType = string;
export type SloMetricType = string;
export type ProblemStatus = string;
export type ChangeType = string;
export type ChangeStatus = string;
export type RiskLevel = string;
export type ChangeTicketRelationship = string;
export type KbArticleStatus = string;
export type TicketLinkType = string;
export type ImprovementSource = string;
export type ImprovementStatus = string;
export type AuditActorType = string;

export interface CalyxTeam { id: number; name: string; slug: string; created_at: string; }
export interface CalyxCategory { [key: string]: any; }
export interface CalyxAgent { [key: string]: any; }
export interface CalyxSlaPolicy { [key: string]: any; }
export interface CalyxTicket { [key: string]: any; }
export interface CalyxTicketEvent { [key: string]: any; }
export interface CalyxComment { [key: string]: any; }
export interface CreateTicketPayload { [key: string]: any; }
export interface UpdateTicketPayload { [key: string]: any; }
export interface CreateCommentPayload { [key: string]: any; }
export interface CreateSlaPolicyPayload { [key: string]: any; }
export interface TicketFilters { [key: string]: any; }
export interface CalyxOrganisation { [key: string]: any; }
export interface CalyxRequester { [key: string]: any; }
export interface CalyxBusinessHours { [key: string]: any; }
export interface CalyxBusinessHoursHoliday { [key: string]: any; }
export interface CalyxSlo { [key: string]: any; }
export interface CalyxTicketSloTracking { [key: string]: any; }
export interface CalyxProblem { [key: string]: any; }
export interface CalyxProblemTicket { [key: string]: any; }
export interface CalyxChange { [key: string]: any; }
export interface CalyxChangeTicket { [key: string]: any; }
export interface CalyxKbArticle { [key: string]: any; }
export interface CalyxCannedResponse { [key: string]: any; }
export interface CalyxTicketWatcher { [key: string]: any; }
export interface CalyxTag { [key: string]: any; }
export interface CalyxTicketTag { [key: string]: any; }
export interface CalyxTicketLink { [key: string]: any; }
export interface CalyxCsatSurvey { [key: string]: any; }
export interface CalyxMajorIncident { [key: string]: any; }
export interface CalyxEmailQueueItem { [key: string]: any; }
export interface CalyxServiceCatalogueItem { [key: string]: any; }
export interface CalyxSupplier { [key: string]: any; }
export interface CalyxImprovement { [key: string]: any; }
export interface CalyxAuditLogEntry { [key: string]: any; }
