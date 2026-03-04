/**
 * Template Builder — builds FileChange[] for Azure DevOps Git push.
 * Replicates the Onboarding.Tool's TemplateService: reads static template files,
 * renders Scriban-style templates, generates BrandSettings.xml, and collects logos.
 *
 * Target path in AzDO: Customisations/UK/{domain}/Template Definitions/
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';
import type { FileChange } from './azdo-client.js';
import type { DeliveryBranch, DeliveryLogo } from '../db/queries.js';
import { LOGO_TYPE_DEFS } from '../../shared/brand-settings-defs.js';

// ─── Binary file extensions (push as base64) ─────────────────────────────────
const BINARY_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.svg', '.webp', '.tif', '.tiff']);

// ─── Settings key mappings (replicates Onboarding.Tool _additionalSettingsToCopy) ─
const ADDITIONAL_SETTINGS_MAP: Record<string, string> = {
  'PortalLead.MarketAppraisalLink': 'contactURL',
  'PortalLead.CallbackLink': 'contactURL',
  'theme.companyName': 'registeredName',
  'bannerAddress': 'bannerWebsite',
  'mainTitlesColour': 'theme.colourPrimary',
  'fontColour': 'mainTextColour',
  'categoryBackground': 'theme.colourPrimary',
  'linkColour': 'theme.colourPrimary',
  'surveyBtnColour': 'theme.colourPrimary',
  'surveyBtnHoverColour': 'theme.colourSecondary',
  'surveyBorder': 'theme.colourSecondary',
  'micrositeBorder': 'theme.colourSecondary',
  'micrositeBtnLink': 'bannerWebsite',
  'micrositeBtnColour': 'theme.colourPrimary',
  'micrositeBtnHoverColour': 'theme.colourSecondary',
  'micrositeIcon': 'theme.colourSecondary',
  'micrositeIconHover': 'theme.colourSecondary',
};

// ─── Branch config → settings mapping (replicates _branchConfigAsSettings) ────
const BRANCH_CONFIG_MAP: Record<string, string> = {
  'ContactForms.NotificationEmailAddress': 'email',
  'theme.companyEmail': 'email',
  'companyEmail': 'email',
  'FromAddress': 'from-address',
  'ReplyToAddress': 'email',
  'theme.companyPhone': 'phone',
  'companyPhone': 'phone',
  'footerText2': 'address',
  'footerHTMLText2': 'address-split',
  'footerText1': 'name',
  'footerHTMLText1': 'name',
};

export interface TemplateBuilderOpts {
  domain: string;           // e.g. "acmeestates.co.uk"
  subdomain: string;        // e.g. "acmeestates"
  brandSettings: Record<string, string>;
  branches: DeliveryBranch[];
  logos: DeliveryLogo[];     // full rows with image_data
}

export class TemplateBuilder {
  constructor(private templateDir: string) {}

  /**
   * Build the complete FileChange[] array for the AzDO push.
   * Target: Customisations/UK/{domain}/
   */
  async buildFileChanges(opts: TemplateBuilderOpts): Promise<FileChange[]> {
    const { domain, subdomain, brandSettings, branches, logos } = opts;
    const basePath = `/Customisations/UK/${domain}`;
    const files: FileChange[] = [];

    // 1. Solution file
    files.push(this.buildSolutionFile(basePath, subdomain));

    // 2. Static template files (Messages, Newsletters, Triggers, etc.)
    files.push(...this.getStaticTemplateFiles(basePath));

    // 3. Default images (bgImage.jpg, digivalBackground.jpg)
    files.push(...this.getStaticImages(basePath));

    // 4. Customer logos
    files.push(...this.getCustomerLogos(basePath, logos));

    // 5. Rendered Scriban templates
    files.push(this.renderMicrosite(basePath, subdomain, brandSettings));
    files.push(this.renderTemplateSet(basePath, domain));
    files.push(this.renderProjectFile(basePath, logos));

    // 6. Generated BrandSettings.xml
    files.push(this.generateBrandSettingsXml(basePath, subdomain, brandSettings, branches));

    return files;
  }

  // ─── 1. Solution file ────────────────────────────────────────────────────────

  private buildSolutionFile(basePath: string, subdomain: string): FileChange {
    const content = readFileSync(join(this.templateDir, 'Solution Files', 'Solution Template.sln'), 'utf-8');
    return {
      path: `${basePath}/${subdomain}.sln`,
      content,
      contentType: 'rawtext',
    };
  }

  // ─── 2. Static template files ────────────────────────────────────────────────

  private getStaticTemplateFiles(basePath: string): FileChange[] {
    const templateDefDir = join(this.templateDir, 'Template Definitions');
    return this.readDirRecursive(templateDefDir, `${basePath}/Template Definitions`);
  }

  // ─── 3. Default images ───────────────────────────────────────────────────────

  private getStaticImages(basePath: string): FileChange[] {
    const imagesDir = join(this.templateDir, 'Images', 'Templates');
    const files: FileChange[] = [];
    try {
      for (const name of readdirSync(imagesDir)) {
        const fullPath = join(imagesDir, name);
        if (!statSync(fullPath).isFile()) continue;
        const content = readFileSync(fullPath).toString('base64');
        files.push({
          path: `${basePath}/Template Definitions/Images/Templates/${name}`,
          content,
          contentType: 'base64encoded',
        });
      }
    } catch { /* images dir may not exist */ }
    return files;
  }

  // ─── 4. Customer logos ───────────────────────────────────────────────────────

  private getCustomerLogos(basePath: string, logos: DeliveryLogo[]): FileChange[] {
    const files: FileChange[] = [];
    for (const logo of logos) {
      if (!logo.image_data) continue;
      const typeDef = LOGO_TYPE_DEFS.find(t => t.type === logo.logo_type);
      const ext = this.mimeToExt(logo.mime_type);
      const fileName = typeDef
        ? `${typeDef.key}.${ext}`
        : `logo-${logo.logo_type}.${ext}`;

      files.push({
        path: `${basePath}/Template Definitions/Images/Templates/${fileName}`,
        content: logo.image_data,
        contentType: 'base64encoded',
      });
    }
    return files;
  }

  // ─── 5a. Render ResponsiveMicrosite03.master ─────────────────────────────────

  private renderMicrosite(basePath: string, subdomain: string, settings: Record<string, string>): FileChange {
    let content = readFileSync(join(this.templateDir, 'Solution Files', 'ResponsiveMicrosite03.master'), 'utf-8');
    content = this.replaceVar(content, 'google_code', settings['GoogleAnalytics'] || '');
    content = this.replaceVar(content, 'customer_website', settings['bannerWebsite'] || '');
    content = this.replaceVar(content, 'instance', `${subdomain}.briefyourmarket.com`);
    return {
      path: `${basePath}/Template Definitions/ResponsiveMicrosite03.master`,
      content,
      contentType: 'rawtext',
    };
  }

  // ─── 5b. Render TemplateSet.xml ──────────────────────────────────────────────

  private renderTemplateSet(basePath: string, domain: string): FileChange {
    let content = readFileSync(join(this.templateDir, 'Solution Files', 'TemplateSet.xml'), 'utf-8');
    content = this.replaceVar(content, 'domain', domain);
    return {
      path: `${basePath}/Template Definitions/TemplateSet.xml`,
      content,
      contentType: 'rawtext',
    };
  }

  // ─── 5c. Render Template Definitions.csproj ──────────────────────────────────

  private renderProjectFile(basePath: string, logos: DeliveryLogo[]): FileChange {
    let content = readFileSync(join(this.templateDir, 'Solution Files', 'Template Definitions.csproj'), 'utf-8');

    // aspx_pages: generate <Content Include="..."> entries for Site/*.aspx pages
    const aspxPages = [
      'ContactUsComplete', 'ContactUsFailed',
      'GetAQuote', 'GetAQuoteComplete', 'GetAQuoteFailed',
      'RequestAValuation', 'ValuationRequestComplete', 'ValuationRequestFailed',
    ].map(p => `\t<Content Include="Documents\\Site\\${p}.aspx"/>`).join('\n');
    content = this.replaceVar(content, 'aspx_pages', aspxPages);

    // image_logo: primary logo filename
    const logoType = logos.find(l => l.logo_type === 0);
    const logoFileName = logoType
      ? `logo.${this.mimeToExt(logoType.mime_type)}`
      : 'logo.png';
    content = this.replaceVar(content, 'image_logo', logoFileName);

    // image_splash: splash image filename
    const splashType = logos.find(l => l.logo_type === 1);
    const splashFileName = splashType
      ? `splash.${this.mimeToExt(splashType.mime_type)}`
      : 'splash.png';
    content = this.replaceVar(content, 'image_splash', splashFileName);

    return {
      path: `${basePath}/Template Definitions/Template Definitions.csproj`,
      content,
      contentType: 'rawtext',
    };
  }

  // ─── 6. Generate BrandSettings.xml ───────────────────────────────────────────

  private generateBrandSettingsXml(
    basePath: string,
    subdomain: string,
    rawSettings: Record<string, string>,
    branches: DeliveryBranch[],
  ): FileChange {
    // Build the full settings map (raw + computed + additional mappings)
    const settings = { ...rawSettings };
    const defaultBranch = branches.find(b => b.is_default) || branches[0];
    const companyName = settings['companyName'] || '';

    // ── Auto-generated settings (replicates Onboarding.Tool lines 405-489) ──

    // Logo/image URLs
    const logoUrl = `https://${subdomain}.briefyourmarket.com/Images/Templates/logo.png`;
    const splashUrl = `https://${subdomain}.briefyourmarket.com/Images/Templates/splash.png`;
    Object.assign(settings, {
      'banner': logoUrl,
      'surveyHeader': logoUrl,
      'micrositeLogo': logoUrl,
      'splashImage': splashUrl,
      'splashImageShow': '1',
      'splashWidth': '600',
      'splashHeight': '315',
      'logoWidth': '200',
      'pointerImage': `https://${subdomain}.briefyourmarket.com/Images/Templates/chevron.png`,
    });

    // Colour-derived settings
    const primary = settings['theme.colourPrimary'] || '#333333';
    const secondary = settings['theme.colourSecondary'] || '#666666';
    const headerBg = settings['headerBackground'] || primary;
    const headerTxt = settings['headerText'] || '#ffffff';
    const footerBg = settings['footerBackground'] || '#333333';
    const footerTxt = settings['footerText'] || '#ffffff';
    const mainText = settings['mainTextColour'] || '#333333';

    Object.assign(settings, {
      'mainBackground': '#ffffff',
      'backgroundColour': '#ffffff',
      'backgroundTextColour': mainText,
      'mainTitlesColour': primary,
      'fontColour': mainText,
      'categoryBackground': primary,
      'categoryHeaderColour': '#ffffff',
      'categoryTextColour': mainText,
      'categoryUpdateTextColour': primary,
      'categoryTickColour': primary,
      'linkColour': primary,
      'surveyBtnColour': primary,
      'surveyBtnHoverColour': secondary,
      'surveyBtnText': '#ffffff',
      'surveyBtnTextHover': '#ffffff',
      'surveyBorder': secondary,
      'survey1BgColour': '#f5f5f5',
      'survey2BgColour': '#ffffff',
      'survey3BoxShadow': '0 2px 4px rgba(0,0,0,0.1)',
      'micrositeBorder': secondary,
      'micrositeBtnLink': settings['bannerWebsite'] || '',
      'micrositeBtnColour': primary,
      'micrositeBtnHoverColour': secondary,
      'micrositeIcon': secondary,
      'micrositeIconHover': secondary,
      'fontFamily': 'Arial',
      'fontSize': '12px',
    });

    // Article style settings (no CDATA wrappers — per nt-1658 fix)
    Object.assign(settings, {
      'articleMainStyles': `color: ${primary}; font-family: Arial`,
      'articleTitleStyles': `font-family:Arial, sans-serif;color:${primary};font-weight:bold;padding-top:10px;font-size:16px`,
      'articleImageStyles': 'vertical-align:top',
      'articleTeaserStyles': 'font-family:Arial;font-size:12px;vertical-align:top',
      'articleMoreLinkContainerStyles': 'font-family:Arial',
      'articleMoreLinkStyles': `text-decoration:none;color:${primary}`,
      'articleTitleLinkStyles': `font-family:Arial;color:${primary};font-weight:bold;font-size:16px;text-decoration:none`,
    });

    // Button text colours
    Object.assign(settings, {
      'micrositeBtnText': '#ffffff',
      'micrositeBtnTextHover': '#ffffff',
    });

    // URL settings
    Object.assign(settings, {
      'theme.valuationLink': `https://${subdomain}.briefyourmarket.com/valuation`,
      'ezineURL': '',
    });

    // Social media: set show flags (1 = visible, 2 = hidden)
    for (const platform of ['Twitter', 'Facebook', 'Linkedin', 'Youtube', 'Instagram']) {
      const urlKey = `${platform}URL`;
      const showKey = `${platform}Show`;
      settings[showKey] = settings[urlKey] ? '1' : '2';
      if (!settings[urlKey]) settings[urlKey] = '#';
    }

    // ── Apply additional settings mappings ──
    for (const [targetKey, sourceKey] of Object.entries(ADDITIONAL_SETTINGS_MAP)) {
      if (settings[sourceKey] && !settings[targetKey]) {
        settings[targetKey] = settings[sourceKey];
      }
    }

    // ── Build per-branch overrides ──
    const branchOverrides = new Map<string, Record<string, string>>();
    for (const branch of branches) {
      const overrides: Record<string, string> = {};

      for (const [settingKey, fieldType] of Object.entries(BRANCH_CONFIG_MAP)) {
        const value = this.getBranchFieldValue(branch, fieldType, companyName);
        if (value) overrides[settingKey] = value;
      }

      if (Object.keys(overrides).length > 0) {
        branchOverrides.set(branch.name, overrides);
      }
    }

    // ── Build XML ──
    const sortedKeys = Object.keys(settings).sort();
    const lines: string[] = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<BrandSettings>',
    ];

    for (const key of sortedKeys) {
      const defaultValue = settings[key] ?? '';
      lines.push(`  <Setting Name="${this.escapeXml(key)}">`);
      lines.push(`    <DefaultValue>${this.escapeXml(defaultValue)}</DefaultValue>`);

      // Add branch-specific overrides
      for (const branch of branches) {
        const overrides = branchOverrides.get(branch.name);
        if (overrides && overrides[key]) {
          lines.push(`    <Value Brand="${this.escapeXml(branch.name)}">${this.escapeXml(overrides[key])}</Value>`);
        }
      }

      lines.push('  </Setting>');
    }

    lines.push('</BrandSettings>');

    return {
      path: `${basePath}/Template Definitions/BrandSettings.xml`,
      content: lines.join('\n'),
      contentType: 'rawtext',
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Recursively read all files from a directory, returning FileChange[]. */
  private readDirRecursive(dirPath: string, targetBase: string): FileChange[] {
    const files: FileChange[] = [];
    try {
      for (const entry of readdirSync(dirPath)) {
        const fullPath = join(dirPath, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...this.readDirRecursive(fullPath, `${targetBase}/${entry}`));
        } else {
          const ext = extname(entry).toLowerCase();
          if (BINARY_EXTS.has(ext)) {
            files.push({
              path: `${targetBase}/${entry}`,
              content: readFileSync(fullPath).toString('base64'),
              contentType: 'base64encoded',
            });
          } else {
            files.push({
              path: `${targetBase}/${entry}`,
              content: readFileSync(fullPath, 'utf-8'),
              contentType: 'rawtext',
            });
          }
        }
      }
    } catch { /* dir may not exist */ }
    return files;
  }

  /** Replace a Scriban-style {{ varName }} placeholder in content. */
  private replaceVar(content: string, varName: string, value: string): string {
    const pattern = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`, 'g');
    return content.replace(pattern, value);
  }

  /** Map MIME type to file extension. */
  private mimeToExt(mime: string): string {
    if (mime === 'image/svg+xml') return 'svg';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/webp') return 'webp';
    return 'jpg';
  }

  /** Escape XML special characters. */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /** Extract a branch field value by type (email, phone, address, name). */
  private getBranchFieldValue(branch: DeliveryBranch, fieldType: string, companyName: string): string {
    switch (fieldType) {
      case 'email':
        return branch.sales_email || '';
      case 'phone': {
        // Convert +44 to 0 (domestic format)
        const phone = branch.sales_phone || '';
        return phone.startsWith('+44') ? '0' + phone.slice(3).trimStart() : phone;
      }
      case 'address': {
        const parts = [branch.address1, branch.address2, branch.address3, branch.town]
          .filter(Boolean);
        const postCode = [branch.post_code1, branch.post_code2].filter(Boolean).join(' ');
        if (postCode) parts.push(postCode);
        return parts.join(', ');
      }
      case 'address-split': {
        const parts = [branch.address1, branch.address2, branch.address3, branch.town]
          .filter(Boolean);
        const postCode = [branch.post_code1, branch.post_code2].filter(Boolean).join(' ');
        if (postCode) parts.push(postCode);
        return parts.join('<br/>');
      }
      case 'name':
        return branch.is_default ? companyName : `${companyName} - ${branch.name}`;
      case 'from-address': {
        // Format: "CompanyName <email>" (per nt-1658 fix)
        const email = branch.sales_email || '';
        const name = branch.is_default ? companyName : `${companyName} - ${branch.name}`;
        return name ? `${name} <${email}>` : email;
      }
      default:
        return '';
    }
  }
}
