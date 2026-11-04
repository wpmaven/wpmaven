/**
 * The kit's own words: the labels its components draw when the app gives
 * none (the chat box's hint, Send, Attach file, a modal's Close, the working
 * mark's name), in the page's language. They were English constants, so a
 * Spanish visitor of /create read "Shift + Enter for a new line" under the
 * box and heard "Send".
 *
 * English is the source; the other languages are the catalogs' namespace
 * "kit". The setup screens' catalogs carry it (@yotako/wpmaven-onboarding,
 * made from this object by its translation script), so any page that loads
 * them reads the kit in its language; a page that loads none reads English,
 * as before. A prop the app passes (hint, placeholder) still wins.
 */
import { localized } from './language';

export const KIT_COPY_EN = {
  chatInput: {
    /** Under the chat box, on the right (a computer's keyboard). */
    newlineHint: 'Shift + Enter for a new line',
    /** The box's placeholder when the app gives none. */
    placeholder: 'Type a message...',
    /** The send button's name for a screen reader (the button shows an arrow). */
    send: 'Send',
    /** The paperclip button's name for a screen reader. */
    attachFile: 'Attach file',
    /** The button that leaves a template with blanks to fill, back to the plain box. */
    cancel: 'Cancel',
    /** That button's name for a screen reader. */
    cancelTemplate: 'Cancel template',
    /** That button's tooltip: Escape does the same. */
    cancelTitle: 'Cancel (Esc)',
  },
  modal: {
    /** A dialog's close button (an X), for a screen reader. */
    close: 'Close',
  },
  logo: {
    /** The mark at work (LogoAnimation, WMLogoProcessing), for a screen reader. */
    working: 'WPMaven is working',
  },
};

/** KIT_COPY_EN in the page's language. */
export const KIT_COPY = localized(KIT_COPY_EN, 'kit');
