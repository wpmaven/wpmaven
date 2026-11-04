/**
 * Where the plugin keeps how far each person got in each tour (1.7.0): the
 * signed-in WordPress user's own meta, through the plugin's route
 * GET/PUT webmaven_wp/v1/tour (backend WebMaven_Tours).
 *
 * Never the account's: the site acts as the owner in the API, so every
 * WordPress user of the site would share the owner's record.
 *
 * One GET answers every tour; it is made once per page and tried again only
 * after a failure. A read that fails rejects, and the kit then treats the
 * tour as unknown (it never opens by itself). The kit checks each record's
 * version and shape.
 */
import type { TourRecord, TourStore } from '@yotako/webmaven-ui';
import { pluginRest } from '../../../services/proxyClient';

/** The plugin's route, after webmaven_wp/v1/. */
export const TOUR_ROUTE = 'tour';

interface ToursAnswer {
  tours?: unknown;
}

type Rest = Pick<typeof pluginRest, 'get' | 'put'>;

export function pluginTourStore(rest: Rest = pluginRest): TourStore {
  let all: Promise<Record<string, unknown>> | null = null;
  const load = (): Promise<Record<string, unknown>> => {
    if (!all) {
      const reading = rest.get<ToursAnswer>(TOUR_ROUTE).then((data) => {
        const tours = data?.tours;
        // PHP answers {} for none; an empty list reads the same.
        return tours && typeof tours === 'object' && !Array.isArray(tours) ? tours as Record<string, unknown> : {};
      });
      all = reading;
      reading.catch(() => { if (all === reading) all = null; });
    }
    return all;
  };
  return {
    async read(tourId: string) {
      const tours = await load();
      const raw = tours[tourId];
      return raw && typeof raw === 'object' ? raw as TourRecord : null;
    },
    async write(tourId: string, record: TourRecord) {
      // The server stamps its own time.
      return rest.put<TourRecord>(TOUR_ROUTE, { tour: tourId, v: record.v, status: record.status, step: record.step });
    },
  };
}
