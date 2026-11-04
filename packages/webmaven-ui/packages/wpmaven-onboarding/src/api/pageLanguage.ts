/**
 * Every call tells the api the page's language: the api writes what the owner reads (its refusals, labels,
 * reasons, plans and reports) in it, and what the business's customers read
 * in the site's language. Without it the api answers in English, as before.
 *
 * The language is read when the call leaves (the reader may switch it), as
 * `lang` in the query, named as the kit names it ("fr", "zh-Hans", "pt-BR").
 */
import { getLanguage } from '@yotako/webmaven-ui';
import type { WizardTransport } from '../host/types';

const wrapped = new WeakSet<WizardTransport>();

/** The page's language as the api reads it. */
export function pageLanguageQuery(): { lang: string } {
  return { lang: getLanguage() };
}

/** The transport with the page's language on every JSON call. */
export function inPageLanguage(transport: WizardTransport): WizardTransport {
  if (wrapped.has(transport)) return transport;
  const out: WizardTransport = {
    request: (call) => transport.request({ ...call, query: { ...(call.query ?? {}), ...pageLanguageQuery() } }),
    ticketedUrl: (path, query) => transport.ticketedUrl(path, query),
    ...(transport.setSiteLanguage ? { setSiteLanguage: transport.setSiteLanguage.bind(transport) } : {}),
  };
  wrapped.add(out);
  return out;
}
