// Helper utility functions

// CSS class name utility
export const cls = (...a) => a.filter(Boolean).join(" ");

// Set CSS custom properties for theming
export function setCSSVars(node, theme) {
  if (!node) return;
  node.style.setProperty("--webmaven-theme", theme.theme);
  node.style.setProperty("--webmaven-accent", theme.accent);
}

// Apply corner positioning for floating elements
export function applyCornerPosition(el, corner, offset) {
  const o = typeof offset === "number" ? offset : 20;
  const s = { top: "", left: "", right: "", bottom: "" };
  
  const positions = {
    "bottom-right": () => {
      s.bottom = `${o}px`;
      s.right = `${o}px`;
    },
    "bottom-left": () => {
      s.bottom = `${o}px`;
      s.left = `${o}px`;
    },
    "top-right": () => {
      s.top = `${o}px`;
      s.right = `${o}px`;
    },
    "top-left": () => {
      s.top = `${o}px`;
      s.left = `${o}px`;
    },
  };

  const positionFn = positions[corner] || positions["bottom-right"];
  positionFn();

  Object.assign(el.style, s);
}

// Token management utilities
// SECURITY: Tokens are now stored server-side only (encrypted in wp_options).
// These functions are kept for backward compatibility but are no-ops.
// Authentication state should be retrieved from server via /status endpoint.

/**
 * @deprecated Tokens are now managed server-side only.
 * Use WordPress nonce for frontend -> plugin communication.
 * Plugin PHP proxies to API with stored encrypted token.
 */
export function getStoredToken() {
  // SECURITY: No longer store tokens in localStorage
  // Return empty string for backward compatibility
  if (process.env.NODE_ENV === 'development') {
    console.warn('getStoredToken() is deprecated. Tokens are now server-side only.');
  }
  return '';
}

/**
 * @deprecated Tokens are now managed server-side only.
 */
export function setStoredToken(token) {
  // SECURITY: No longer store tokens in localStorage
  if (process.env.NODE_ENV === 'development') {
    console.warn('setStoredToken() is deprecated. Tokens are now server-side only.');
  }
  // No-op - tokens are stored encrypted on the server
}

/**
 * @deprecated Tokens are now managed server-side only.
 */
export function clearStoredToken() {
  // SECURITY: Clear any legacy tokens that may exist
  try {
    localStorage.removeItem('wpai_backend_token');
  } catch {
    // Ignore errors
  }
}

/**
 * @deprecated Use server-side authentication status check instead.
 */
export function validateToken() {
  // Authentication is now server-side only
  // Return false to indicate client should check with server
  return false;
}
