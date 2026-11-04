import React from 'react';

/**
 * The tallest the scrolling part of a dialog may be: the screen's visible
 * height (dvh, which follows a phone's browser bars) less what stays on screen
 * around it. That is the overlay's margin (32px), the dialog's header with a
 * title of up to four lines at 400px (about 112px), the dialog's own padding
 * (40px), and the row under it with Close (about 44px).
 */
export const MODAL_SCROLL_MAX_HEIGHT = 'calc(100dvh - 240px)';

/**
 * The inside of a Modal that can hold more than a screen: a long blog post
 * opened in full, a video with its whole caption.
 *
 * The Modal (@yotako/webmaven-ui) centers its panel and cuts what overflows
 * it, with no height limit of its own. A post taller than the screen pushed
 * the title and the X above the top edge and Close below the bottom one, with
 * nothing to scroll. Here the content scrolls in a box
 * that always fits the screen, and `footer` (Close) sits under that box, so
 * the header, the X and Close stay on screen at 400px and on a desktop.
 *
 * The box can take keyboard focus, so it can be scrolled without a mouse.
 */
export const ModalScrollBody: React.FC<{
  children: React.ReactNode;
  /** Stays under the scrolling box, always on screen (Close). */
  footer?: React.ReactNode;
  /** What the box holds, for a screen reader ("The approval in full"). */
  label?: string;
}> = ({ children, footer, label }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div
      data-testid="modal-scroll"
      role="region"
      aria-label={label}
      tabIndex={0}
      style={{
        maxHeight: MODAL_SCROLL_MAX_HEIGHT,
        overflowY: 'auto',
        overscrollBehavior: 'contain',
      }}
    >
      {/* A block scroller with the column inside it: a flex scroller lets
          a child that clips its own overflow (a rounded image card) shrink
          to fit, squashing the post instead of scrolling it. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
    {footer ? <div data-testid="modal-footer">{footer}</div> : null}
  </div>
);
