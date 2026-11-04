/**
 * The AI team in the plugin's words (the dashboard says the same): the
 * Co-CEO leads every chat, except the editor's, which the Web Designer leads
 * once the account says so (1.8.0); each step, edit and approval is signed
 * by the one on the team who does it; a person's own change shows no face.
 * Owner copy says "your team" and "your {Title}", never "operators" (a
 * plan's name) or "AI assistant".
 */

export const LEAD_OPERATOR = 'chief_of_staff';

/** Who leads the editor's chat when the account's features.editorDesigner is on (1.8.0). */
export const EDITOR_LEAD_OPERATOR = 'web_designer';

/** The titles the API's catalog gives (payloads carry their own; this names a bare id). */
const TITLES: Readonly<Record<string, string>> = {
  chief_of_staff: 'Co-CEO',
  web_developer: 'Web Developer',
  web_designer: 'Web Designer',
  webmaster: 'Webmaster',
  content_writer: 'Content Writer',
  seo_specialist: 'SEO Specialist',
  social_media_manager: 'Social Media Manager',
  data_analyst: 'Data Analyst',
  ecommerce_manager: 'E-commerce Manager',
  customer_support: 'Customer Support Agent',
  chief_financial_officer: 'Chief Financial Officer',
  growth_concierge: 'Growth Concierge',
  video_producer: 'Video Producer',
};

/** An operator's title by id; "Team member" for an id the catalog does not know. */
export function operatorTitle(id: string): string {
  return TITLES[id] ?? 'Team member';
}

/** An operator as the API names it: the id draws the face, the title is said. */
export interface OperatorRef {
  id: string;
  title: string;
}

/** An operator id as the kit reads one (digits allowed). */
const ID = /^[a-z][a-z0-9_]{0,39}$/;

/** An operator from an API field ({ id, title } or a bare id), or null. */
export function operatorRefOf(raw: unknown): OperatorRef | null {
  if (typeof raw === 'string') return ID.test(raw) ? { id: raw, title: operatorTitle(raw) } : null;
  if (!raw || typeof raw !== 'object') return null;
  const { id, title } = raw as { id?: unknown; title?: unknown };
  if (typeof id !== 'string' || !ID.test(id)) return null;
  const t = typeof title === 'string' && title.trim() ? title.trim().slice(0, 60) : operatorTitle(id);
  return { id, title: t };
}

/** A chat lead's own title: the Co-CEO's ("Co-CEO") unless another lead is named. */
export function leadTitle(lead: string = LEAD_OPERATOR): string {
  return operatorTitle(lead);
}

export const TEAM_COPY = {
  notConnected: 'The chat cannot reach your team right now.',
  needsYes: (title: string) => `Your ${title} needs your yes`,
  preparedBy: (title: string) => `Prepared by your ${title}`,
  doneBy: (title: string) => `Live on your site. Done by your ${title}.`,
  stoppedBy: (title: string) => `This change did not go through. Your ${title} stopped before anything changed.`,
  teamHeading: 'Your team',
  scheduledBy: (title: string) => `Scheduled by your ${title}`,
  scheduledByYou: 'Scheduled by you',
} as const;

/** The editor's AI operations and who on the team prepares them; a person's own edits are not here (no face). */
const AI_OP_OPERATOR: Readonly<Record<string, string>> = {
  edit_section: 'web_designer', add_section: 'web_designer', edit_chrome: 'web_designer',
  edit_site: 'web_designer', replace_image: 'web_designer', add_page: 'content_writer',
  rewrite_post: 'content_writer', redesign_page: 'web_designer',
};

/** Who on the team prepares an editor operation, or null when the owner does it by hand. */
export function operatorForOperation(op: string | null | undefined): OperatorRef | null {
  const id = op ? AI_OP_OPERATOR[op] : undefined;
  return id ? { id, title: operatorTitle(id) } : null;
}

/** A working sentence signed by who does the work ("Your Web Designer is on it: preparing your preview."). */
export function signedWorking(text: string, who: OperatorRef | null | undefined): string {
  if (!who) return text;
  const rest = text.charAt(0).toLowerCase() + text.slice(1);
  return `Your ${who.title} is on it: ${rest}`;
}

/** The preview banner, signed when the team prepared it. */
export function previewBanner(who: OperatorRef | null | undefined): string {
  return who ? `Prepared by your ${who.title}. Not live yet.` : 'Preview of your change. Not live yet.';
}
