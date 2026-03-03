/**
 * Shared brand setting / logo type definitions used by both client and server.
 */

export type BrandSettingType = 'text' | 'url' | 'color' | 'email';
export type BrandSettingGroup = 'company' | 'social' | 'colors' | 'cta' | 'urls' | 'analytics';

export interface BrandSettingDef {
  key: string;
  label: string;
  group: BrandSettingGroup;
  type: BrandSettingType;
  required?: boolean;
  placeholder?: string;
}

export const BRAND_SETTING_GROUPS = [
  { id: 'company', label: 'Company Details' },
  { id: 'social', label: 'Social Media' },
  { id: 'colors', label: 'Colours & Theme' },
  { id: 'cta', label: 'Call to Action' },
  { id: 'urls', label: 'URLs' },
  { id: 'analytics', label: 'Analytics' },
] as const;

export const BRAND_SETTING_DEFS: BrandSettingDef[] = [
  // Company
  { key: 'companyName', label: 'Company Name', group: 'company', type: 'text', required: true },
  { key: 'registeredName', label: 'Registered Name', group: 'company', type: 'text' },
  { key: 'registeredAddress', label: 'Registered Address', group: 'company', type: 'text' },
  { key: 'registeredNumber', label: 'Company Number', group: 'company', type: 'text' },
  { key: 'registeredVATNo', label: 'VAT Number', group: 'company', type: 'text' },
  { key: 'bannerWebsite', label: 'Website URL', group: 'company', type: 'url', required: true },

  // Social
  { key: 'TwitterURL', label: 'Twitter / X', group: 'social', type: 'url', placeholder: 'https://x.com/...' },
  { key: 'FacebookURL', label: 'Facebook', group: 'social', type: 'url', placeholder: 'https://facebook.com/...' },
  { key: 'LinkedinURL', label: 'LinkedIn', group: 'social', type: 'url', placeholder: 'https://linkedin.com/company/...' },
  { key: 'InstagramURL', label: 'Instagram', group: 'social', type: 'url', placeholder: 'https://instagram.com/...' },
  { key: 'YoutubeURL', label: 'YouTube', group: 'social', type: 'url', placeholder: 'https://youtube.com/...' },

  // Colours
  { key: 'theme.colourPrimary', label: 'Primary Colour', group: 'colors', type: 'color', required: true },
  { key: 'theme.colourSecondary', label: 'Secondary Colour', group: 'colors', type: 'color', required: true },
  { key: 'headerBackground', label: 'Header Background', group: 'colors', type: 'color', required: true },
  { key: 'headerText', label: 'Header Text', group: 'colors', type: 'color', required: true },
  { key: 'footerBackground', label: 'Footer Background', group: 'colors', type: 'color', required: true },
  { key: 'footerText', label: 'Footer Text', group: 'colors', type: 'color', required: true },
  { key: 'mainTextColour', label: 'Main Text Colour', group: 'colors', type: 'color', required: true },

  // CTAs
  { key: 'CTAText1', label: 'CTA 1 Text', group: 'cta', type: 'text' },
  { key: 'CTALink1', label: 'CTA 1 Link', group: 'cta', type: 'url' },
  { key: 'CTAText2', label: 'CTA 2 Text', group: 'cta', type: 'text' },
  { key: 'CTALink2', label: 'CTA 2 Link', group: 'cta', type: 'url' },
  { key: 'CTAText3', label: 'CTA 3 Text', group: 'cta', type: 'text' },
  { key: 'CTALink3', label: 'CTA 3 Link', group: 'cta', type: 'url' },
  { key: 'CTAText4', label: 'CTA 4 Text', group: 'cta', type: 'text' },
  { key: 'CTALink4', label: 'CTA 4 Link', group: 'cta', type: 'url' },
  { key: 'CTAText5', label: 'CTA 5 Text', group: 'cta', type: 'text' },
  { key: 'CTALink5', label: 'CTA 5 Link', group: 'cta', type: 'url' },

  // URLs
  { key: 'contactURL', label: 'Contact Us URL', group: 'urls', type: 'url', required: true },
  { key: 'MainCTALink', label: 'Main CTA Link', group: 'urls', type: 'url' },
  { key: 'ProductMoreLinkBase', label: 'Product More Link Base', group: 'urls', type: 'url' },
  { key: 'theme.digivalLink', label: 'Instant Valuation Link', group: 'urls', type: 'url' },

  // Analytics
  { key: 'GoogleAnalytics', label: 'Google Analytics ID', group: 'analytics', type: 'text', placeholder: 'UA-XXXXXXXX-X or G-XXXXXXXXXX' },
];

export interface LogoTypeDef {
  type: number;
  key: string;
  label: string;
  description: string;
}

export const LOGO_TYPE_DEFS: LogoTypeDef[] = [
  { type: 0, key: 'logo', label: 'Primary Logo', description: 'Main website logo' },
  { type: 1, key: 'splash', label: 'Splash Screen', description: 'Loading / splash image' },
  { type: 2, key: 'printLogo', label: 'Print Logo', description: 'Logo for print materials' },
  { type: 3, key: 'logoAlternate', label: 'Alternate Logo', description: 'Light / greyscale version' },
  { type: 4, key: 'printLogoAlternate', label: 'Alternate Print Logo', description: 'Secondary print version' },
];
