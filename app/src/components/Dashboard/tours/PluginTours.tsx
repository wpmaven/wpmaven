import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TourProvider, useTour, type TourApi, type TourEnd, type TourStore } from '@yotako/webmaven-ui';
import { useDashboard } from '../../../contexts/DashboardContext';
import { routeAllowsTier, routeById } from '../pages/registry/routes';
import { EDITOR_PAGE, OVERVIEW_PAGE, pluginTours, type PluginTourId } from './tourSteps';
import { arrivedFromDashboard, editorFollows, overviewTourId, overviewTourToOpen } from './tourPicker';
import { pluginTourStore } from './tourStore';

/**
 * The plugin's guided tours (1.7.0) on the kit's engine: the three tours,
 * the user meta store, and the picker.
 *
 *  - On the first visit to Overview: the full tour, or the WordPress one for
 *    someone who came from the dashboard.
 *  - On the first visit to the editor: the editor's tour.
 *  - The full tour's last step waits for the click on the top bar's Editor;
 *    the click opens the editor and the editor's tour follows.
 *  - The "?" in the top bar (HelpMenu) replays them, through usePluginTours.
 *
 * Overview keeps its menu closed by default. While one of its tours is up
 * on a wide screen the menu is shown, without changing what the page
 * remembers, and put back when the tour ends there. On a narrow screen the
 * menu is a slide-over that would cover Overview's own steps: the tour
 * passes the menu's steps there.
 */

export interface PluginToursApi {
  /** The tour of Overview for this person (full, or WordPress for someone who came from the dashboard). */
  takeTour: () => void;
  takeEditorTour: () => void;
  /** This WordPress user may open the editor (an administrator). */
  mayEdit: boolean;
  overviewTour: 'full' | 'wordpress';
}

/** The Editor is a page for this WordPress user. */
export function mayOpenEditor(): boolean {
  return routeAllowsTier(routeById(EDITOR_PAGE));
}

const PluginToursContext = createContext<PluginToursApi | null>(null);

/** The tours' replays, for the "?" menu. Outside the app's tours: words only, nothing starts. */
export function usePluginTours(): PluginToursApi {
  const value = useContext(PluginToursContext);
  return value ?? {
    takeTour: () => undefined,
    takeEditorTour: () => undefined,
    mayEdit: mayOpenEditor(),
    overviewTour: overviewTourId(arrivedFromDashboard()),
  };
}

/** At this width and below the menu is a slide-over (MinimalTopBar's own breakpoint). */
const NARROW = 768;

/**
 * The tour's layers. A step the person clicks through (Edit your site)
 * sits above the narrow screen's slide-over menu (60), should it be open;
 * no step of these tours opens a dialog. The app's screens, its dialogs
 * included, all live under the main column's own layer.
 */
const TOUR_LAYERS = { read: 80, used: 70 } as const;

/**
 * Inside the kit's provider: the first visits, the menu shown during an
 * Overview tour, and the replays the "?" asks for.
 */
function TourDirector({ apiRef, replays, children }: {
  apiRef: React.MutableRefObject<TourApi | null>;
  replays: React.MutableRefObject<Set<string>>;
  children: React.ReactNode;
}) {
  const tour = useTour();
  apiRef.current = tour;
  const { currentPage, sidebarOpen, peekSidebar } = useDashboard();
  const mayEdit = mayOpenEditor();

  // First visits: once the records are read, and on every arrival on a page.
  useEffect(() => {
    if (!tour.loaded) return;
    if (currentPage === OVERVIEW_PAGE) {
      const id = overviewTourToOpen(tour.record, arrivedFromDashboard());
      if (id) tour.startOnce(id);
    } else if (currentPage === EDITOR_PAGE && mayEdit) {
      tour.startOnce('editor');
    }
    // Only on arriving on a page, or once the records are in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, tour.loaded]);

  // The menu, shown while an Overview tour is up on Overview, on a wide screen.
  const shown = useRef(false);
  const overviewTourUp = !!tour.current && tour.current.tourId !== 'editor';
  useEffect(() => {
    if (overviewTourUp && currentPage === OVERVIEW_PAGE && !shown.current) {
      const wide = typeof window !== 'undefined' && window.innerWidth > NARROW;
      if (wide && !sidebarOpen) {
        peekSidebar(true);
        shown.current = true;
      }
      return;
    }
    if (!overviewTourUp && shown.current) {
      // Gone to another page (the Editor): that page has its own menu already.
      if (currentPage === OVERVIEW_PAGE) peekSidebar(false);
      shown.current = false;
    }
    // Only when a tour opens or closes, or the page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewTourUp, currentPage]);

  const value = useMemo<PluginToursApi>(() => {
    const take = (id: PluginTourId) => {
      replays.current.add(id);
      tour.start(id);
    };
    const overviewTour = overviewTourId(arrivedFromDashboard());
    return {
      takeTour: () => take(overviewTour),
      takeEditorTour: () => { if (mayEdit) take('editor'); },
      mayEdit,
      overviewTour,
    };
  }, [tour.start, mayEdit, replays]);

  return <PluginToursContext.Provider value={value}>{children}</PluginToursContext.Provider>;
}

export interface PluginToursProps {
  children: React.ReactNode;
  /** Where the records live (tests pass their own); the plugin's /tour route by default. */
  store?: TourStore;
}

export function PluginTours({ children, store }: PluginToursProps) {
  const { currentPage, setCurrentPage } = useDashboard();
  const tours = useMemo(() => pluginTours(), []);
  const [ownStore] = useState<TourStore>(() => store ?? pluginTourStore());
  const apiRef = useRef<TourApi | null>(null);
  const replays = useRef<Set<string>>(new Set());

  const onNeedPage = useCallback((page: string) => setCurrentPage(page), [setCurrentPage]);

  // The full tour's last step got its click on the Editor: the editor's tour follows.
  const onEnd = useCallback((end: TourEnd) => {
    const replay = replays.current.delete(end.tourId);
    const api = apiRef.current;
    if (api && mayOpenEditor() && editorFollows(end, api.record('editor'), replay)) api.start('editor');
  }, []);

  return (
    <TourProvider tours={tours} store={ownStore} page={currentPage} onNeedPage={onNeedPage} onEnd={onEnd} zIndex={TOUR_LAYERS}>
      <TourDirector apiRef={apiRef} replays={replays}>
        {children}
      </TourDirector>
    </TourProvider>
  );
}

export default PluginTours;
