/**
 * Focus mode: the app over the whole window, WordPress's menu and admin bar
 * hidden. Each user's own choice, kept by the plugin (POST /focus-mode) and
 * applied at once through the body class the plugin's styles read.
 */

interface WpData {
  restUrl?: string;
  nonce?: string;
  focusMode?: boolean;
}

const wpData = (): WpData => ((window as any).WEBMAVEN_WP_DATA || {}) as WpData;

export function isFocusMode(): boolean {
  return wpData().focusMode === true;
}

/** Turns Focus mode on or off for this user; answers whether it is on. */
export async function setFocusMode(on: boolean): Promise<boolean> {
  const data = wpData();
  const res = await fetch(`${data.restUrl || '/wp-json/webmaven_wp/v1'}/focus-mode`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': data.nonce || '' },
    body: JSON.stringify({ on }),
  });
  if (!res.ok) {
    throw new Error('Focus mode was not saved. Try again.');
  }
  const answer = (await res.json()) as { focusMode?: unknown };
  const now = answer.focusMode === true;
  document.body.classList.toggle('webmaven-fullscreen', now);
  (window as any).WEBMAVEN_WP_DATA = { ...((window as any).WEBMAVEN_WP_DATA || {}), focusMode: now };
  return now;
}
