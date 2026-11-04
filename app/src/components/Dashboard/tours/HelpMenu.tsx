import React from 'react';
import { HelpButton, NavIcon, type HelpMenuEntry } from '@yotako/webmaven-ui';
import { usePluginTours } from './PluginTours';
import { guidesUrl } from './tourPicker';

export const HELP_LABEL = 'Help';

/** The "?" menu's items: Take the tour, Tour of the editor (who may edit), then the guides (a WPMaven site). */
export function helpMenuItems(o: {
  takeTour: () => void;
  takeEditorTour: () => void;
  mayEdit: boolean;
  guides: string | null;
}): HelpMenuEntry[] {
  const items: HelpMenuEntry[] = [
    { key: 'tour', label: 'Take the tour', icon: <NavIcon name="sparkles" size={18} />, onSelect: o.takeTour, testId: 'wm-help-tour' },
  ];
  if (o.mayEdit) {
    items.push({ key: 'editor-tour', label: 'Tour of the editor', icon: <NavIcon name="pencil-square" size={18} />, onSelect: o.takeEditorTour, testId: 'wm-help-editor-tour' });
  }
  if (o.guides) {
    items.push({ type: 'separator' });
    items.push({ key: 'guides', label: 'Guides', icon: <NavIcon name="document-text" size={18} />, href: o.guides, external: true, testId: 'wm-help-guides' });
  }
  return items;
}

/**
 * The "?" in the top bar (1.7.0), beside the bell, on every page: the
 * kit's HelpButton with the tours and the guides. Take the tour is the full
 * tour, or the WordPress one for someone who came from the dashboard.
 */
export function HelpMenu() {
  const { takeTour, takeEditorTour, mayEdit } = usePluginTours();
  return (
    <HelpButton
      label={HELP_LABEL}
      tour="help"
      testId="wm-help"
      items={helpMenuItems({ takeTour, takeEditorTour, mayEdit, guides: guidesUrl() })}
    />
  );
}

export default HelpMenu;
