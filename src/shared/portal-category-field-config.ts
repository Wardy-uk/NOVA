export interface PortalFieldConfig {
  url: boolean;
  browser: boolean;
  errorMessage: boolean;
  account: boolean;
  description_hint: string;
}

export const PORTAL_ALL_FIELDS: PortalFieldConfig = {
  url: true,
  browser: true,
  errorMessage: true,
  account: true,
  description_hint: 'What should be happening vs what is happening?',
};

export const PORTAL_CATEGORY_FIELD_CONFIG: Record<string, PortalFieldConfig> = {
  website_content: { url: true, browser: false, errorMessage: false, account: true, description_hint: 'What content needs changing? Please include the page URL and the exact text or image to update.' },
  website_broken: { url: true, browser: true, errorMessage: true, account: true, description_hint: 'What should be happening vs what is happening? Include any error messages you see.' },
  website_new_page: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Describe the new page you need — what content should it include and where should it sit in the navigation?' },
  website_design: { url: true, browser: false, errorMessage: false, account: true, description_hint: 'What design changes do you need? Attach any reference images or mockups.' },
  account_login: { url: false, browser: true, errorMessage: true, account: true, description_hint: 'Which login are you having trouble with? What happens when you try to log in?' },
  account_new_user: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Name and email of the new user. Which systems do they need access to?' },
  account_permissions: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which user needs permissions changed? What access do they need?' },
  account_details: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What account details need updating?' },
  account_office_change: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which office or branch needs changing, and what should it be updated to?' },
  account_remove_user: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Who needs removing, and what is their email address?' },
  email_campaign: { url: false, browser: false, errorMessage: true, account: true, description_hint: 'Which campaign is affected? What went wrong with the send?' },
  email_triggers: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which trigger or automation needs attention? What should it be doing?' },
  email_template: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which template? Attach the content or describe the changes needed.' },
  leadpro_missing: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'When did the lead come in? Which source or portal? Include any reference numbers.' },
  leadpro_setup: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What needs setting up or configuring in LeadPro?' },
  leadpro_access: { url: false, browser: true, errorMessage: true, account: true, description_hint: 'What happens when you try to access LeadPro?' },
  feeds_property: { url: false, browser: false, errorMessage: true, account: true, description_hint: 'Which feed is affected? When did it last work? Include any error messages from your CRM.' },
  feeds_integration: { url: false, browser: false, errorMessage: true, account: true, description_hint: 'Which integration? What system is it connecting to?' },
  feeds_reporting: { url: true, browser: false, errorMessage: false, account: true, description_hint: 'Which report or analytics view is affected?' },
  listings_tours: { url: true, browser: true, errorMessage: false, account: true, description_hint: 'Which property? Include the property address or listing reference.' },
  listings_media: { url: true, browser: false, errorMessage: false, account: true, description_hint: 'Which property and what images need attention?' },
  listings_management: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which listings are affected? What action do you need?' },
  property_missing_listing: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property is affected, and where is it missing from?' },
  property_incorrect_details: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property is affected, and what details are wrong?' },
  property_media: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property is affected, and what media is wrong or missing?' },
  property_feed_sync: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property is affected, and which portals are showing the issue?' },
  property_status: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property is affected, and what status issue are you seeing?' },
  property_visibility: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which property is affected, and where is it not visible?' },
  letters_market_appraisal: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which area or addresses? How many letters?' },
  letters_mailshot: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What type of mailshot? Target area and quantity.' },
  letters_general: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What type of correspondence and how many?' },
  onboarding_branch: { url: false, browser: false, errorMessage: false, account: false, description_hint: 'Branch name, address, and which products they need.' },
  onboarding_product: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which product do you need set up?' },
  onboarding_training: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What training do you need? How many attendees?' },
  billing_cancel: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which service are you cancelling? Any specific date?' },
  billing_change: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What service change do you need?' },
  billing_query: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What is your billing question?' },
  security_vulnerability: { url: true, browser: false, errorMessage: false, account: true, description_hint: 'Describe what you noticed. Include URLs or screenshots if possible.' },
  security_ssl: { url: true, browser: true, errorMessage: true, account: true, description_hint: 'Which website and what certificate warning are you seeing?' },
  security_access: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What happened and when did you notice it?' },
  general_request_change: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What change do you need?' },
  general_request_info: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What information are you looking for?' },
  general_request_other: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'How can we help?' },
  followup_reopen: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which request, and your original ticket reference if you have it.' },
  followup_update: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which request are you chasing? Include your ticket reference if you have it.' },
  followup_not_resolved: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What is still not working? Include your ticket reference if you have it.' },
  complaint_service: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'What happened, and what outcome are you looking for?' },
  complaint_response: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which request, and how long have you been waiting?' },
  complaint_escalate: { url: false, browser: false, errorMessage: false, account: true, description_hint: 'Which issue, and why do you feel it needs escalating?' },
  other_general: { url: false, browser: false, errorMessage: false, account: false, description_hint: 'How can we help?' },
  other_feedback: { url: false, browser: false, errorMessage: false, account: false, description_hint: 'What feedback or suggestion do you have?' },
};
