/**
 * What a team member's face says to a screen reader after the name ("Web
 * Designer, working"): webmaven-ui's own words on an English page, these on
 * a page in another language (OperatorPortrait passes the whole name then).
 * French in i18n/fr.json, namespace "operatorPortrait".
 */
import { localized } from '@yotako/webmaven-ui';

export const OPERATOR_PORTRAIT_COPY_EN = {
  presence: {
    working: 'working',
    waiting: 'waiting for you',
    done: 'done',
    failed: 'could not finish',
    queued: 'up next',
  },
  /** "Web Designer, working". */
  named: (title: string, presence: string) => `${title}, ${presence}`,
} as const;

/** OPERATOR_PORTRAIT_COPY_EN in the page's language. */
export const OPERATOR_PORTRAIT_COPY = localized(OPERATOR_PORTRAIT_COPY_EN, 'operatorPortrait');
