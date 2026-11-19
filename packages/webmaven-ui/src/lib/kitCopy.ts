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
 *
 * Read where it is drawn (KIT_COPY.x at render time, never copied into a
 * module constant), so a page that changes language redraws in it. The
 * exported English constants (CHAT_LONG_LINE...) stay for callers that
 * compare or test them.
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
  /**
   * The Co-CEO's chat (CoCeoChat, the dashboard's Home and the plugin): its
   * own words around the conversation. {0} is the lead's role title as the
   * app names it ("Co-CEO"), drawn in the lead's colour in the header.
   */
  coCeoChat: {
    /** The chat's header: "Your Co-CEO" ({0}: the role title, drawn in its own colour). */
    yourTitle: (title: string) => `Your ${title}`,
    /** The message box's placeholder when the app gives none ({0}: the role title). */
    placeholder: (title: string) => `Tell your ${title} what you'd like to change…`,
    /** The message box's name for a screen reader ({0}: the role title). */
    messageTo: (title: string) => `Message to your ${title}`,
    /** The conversation's name for a screen reader ({0}: the role title). */
    conversationWith: (title: string) => `Conversation with your ${title}`,
    /** The plus button that opens a new conversation (its tooltip), and the name of a conversation with no subject yet. */
    newChat: 'New chat',
    /** The conversation switcher's name for a screen reader ({0}: the open conversation's name). */
    conversation: (name: string) => `Conversation: ${name}`,
    /** The button that opens the chat over the whole page. */
    fullView: 'Full view',
    /** The same button in the full view, for a screen reader. */
    leaveFullView: 'Leave full view',
    /** Its tooltip: Escape does the same. */
    leaveFullViewTitle: 'Leave full view (Esc)',
    /** At the top of the conversation while older messages load. */
    loadingOlder: 'Loading earlier messages…',
    /** A button over the box when messages arrived while the owner read further up. */
    newMessages: 'New messages',
    /** The arrow button that goes down to the newest message (its tooltip). */
    toNewest: 'Back to the newest message',
    /** A step of the team's work that says nothing of its own: it failed. */
    stepFailed: 'This step did not work.',
    /** The same: it is done. */
    stepDone: 'Finished this step.',
    /** The same: it is still running. */
    stepWorking: 'Working on it',
    /** The title of a question the team asks in the chat ({0}: the asking member's role title). */
    needsYes: (title: string) => `Your ${title} needs your yes`,
    /** The question's two buttons. */
    decline: 'Decline',
    approve: 'Approve',
    /** The question once answered: yes. */
    saidYes: 'You said yes.',
    /** The question once answered: no. */
    saidNo: 'You said no.',
    /** The button of the connection's status line when the app names none. */
    retry: 'Retry',
    /** After the connection's status line while it tries again: which try of how many ({0} of {1}). */
    attempt: (n: number, max: number) => `(attempt ${n}/${max})`,
    /** Under a message the team has been working on for a while. */
    longLine: 'Bigger requests can take a few minutes. The answer will show up here, even if you leave this page.',
    /** Under a message that got no answer. */
    unanswered: 'No answer came back for this message. Put it back in the box to send it again.',
    /** Beside Send while a new conversation opens. */
    opening: 'Opening a new chat…',
    /** Beside Send while the team waits for the owner's answer to its question above ({0}: the role title). */
    waitingForYou: (title: string) => `Your ${title} is waiting for your answer above.`,
    /** Beside Send while the team still answers, with words in the box ({0}: the role title). */
    sendWhenAnswered: (title: string) => `You can send this as soon as your ${title} answers.`,
    /** The same with the box empty ({0}: the role title). */
    writeWhileAnswering: (title: string) => `You can write your next message while your ${title} answers.`,
    /** In the conversation when a message did not reach the team ({0}: the role title). */
    sendFailed: (title: string) => `Your message did not reach your ${title}. It is back in the box, so press Send to try again.`,
    /** In the conversation when the owner's answer to a question did not reach the team ({0}: the role title). */
    answerFailed: (title: string) => `Your answer did not reach your ${title}. Try again.`,
    /** A failed answer read back on a later visit, where the words are no longer in the box ({0}: the role title). */
    couldNotFinish: (title: string) => `Your ${title} could not finish this. Put it back in the box to send it again.`,
  },
  /** The light, system and dark buttons (ThemeToggle, in the dashboard's account menu). */
  themeToggle: {
    /** The three buttons' name together, for a screen reader. */
    group: 'Theme',
    /** The sun button. */
    light: 'Light theme',
    /** The screen button: the device's own setting. */
    system: 'Follow system theme',
    /** The moon button. */
    dark: 'Dark theme',
  },
  /** The "?" beside a control (HelpTip). */
  helpTip: {
    /** The link under its sentences, to the help guide, when the app names none. */
    readMore: 'Read more',
  },
};

/** KIT_COPY_EN in the page's language. */
export const KIT_COPY = localized(KIT_COPY_EN, 'kit');
