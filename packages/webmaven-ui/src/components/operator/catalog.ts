/**
 * The team's ids and titles, as the API's operator catalog names them, so a
 * screen can pass an API id straight through. The API stays the source of the
 * titles a payload carries (`operator: { id, title }`); the titles here are the
 * fallback when a screen only has the id.
 */

export type OperatorId =
  | 'chief_of_staff'
  | 'web_developer'
  | 'web_designer'
  | 'webmaster'
  | 'content_writer'
  | 'seo_specialist'
  | 'social_media_manager'
  | 'data_analyst'
  | 'ecommerce_manager'
  | 'customer_support'
  | 'chief_financial_officer'
  | 'growth_concierge'
  | 'video_producer';

/** Every member of the team, in the API catalog's order (the Co-CEO first). */
export const OPERATOR_IDS: readonly OperatorId[] = [
  'chief_of_staff',
  'web_developer',
  'web_designer',
  'webmaster',
  'content_writer',
  'seo_specialist',
  'social_media_manager',
  'data_analyst',
  'ecommerce_manager',
  'customer_support',
  'chief_financial_officer',
  'growth_concierge',
  'video_producer',
];

export const OPERATOR_TITLES: Readonly<Record<OperatorId, string>> = {
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

/** The title a screen shows when the payload only carried an id. */
export const UNKNOWN_OPERATOR_TITLE = 'Team member';

export function isOperatorId(id: unknown): id is OperatorId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(OPERATOR_TITLES, id);
}

export function operatorTitle(id: string | null | undefined): string {
  return isOperatorId(id) ? OPERATOR_TITLES[id] : UNKNOWN_OPERATOR_TITLE;
}
