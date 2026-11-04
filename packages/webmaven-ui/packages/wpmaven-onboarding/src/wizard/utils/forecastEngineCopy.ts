/**
 * The forecast engine's words (forecastEngine.ts): the scenario names and
 * each earning model's unit word, in the page's language. French in
 * i18n/fr.json, namespace "forecastEngine".
 */
import { localized } from '@yotako/webmaven-ui';

export const FORECAST_ENGINE_COPY_EN = {
  scenario: {
    cautious: 'Cautious',
    expected: 'Expected',
    ambitious: 'Ambitious',
  },
  /**
   * Every label and sentence speaks the business's own unit word; `typical`
   * opens the lever "A typical order brings in about" (its article agrees
   * with the word in other languages).
   */
  units: {
    products: { singular: 'order', plural: 'orders', typical: 'A typical order' },
    orders: { singular: 'order', plural: 'orders', typical: 'A typical order' },
    bookings: { singular: 'booking', plural: 'bookings', typical: 'A typical booking' },
    services_quotes: { singular: 'project', plural: 'projects', typical: 'A typical project' },
    events: { singular: 'ticket', plural: 'tickets', typical: 'A typical ticket' },
    donations: { singular: 'donation', plural: 'donations', typical: 'A typical donation' },
  },
} as const;

/** The engine's words in the page's language. */
export const FORECAST_ENGINE_COPY = localized(FORECAST_ENGINE_COPY_EN, 'forecastEngine');
