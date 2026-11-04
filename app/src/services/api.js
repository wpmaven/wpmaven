import { refusedTurn } from './chatTurn';

/** Generate a simple trace ID */
function generateTraceId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** The plugin's code for "this site holds no link to WPMaven" (1.2.9). */
export const SITE_NOT_CONNECTED_CODE = 'wpmaven_site_not_connected';
/** Window event AuthContext listens to: re-read /status. */
export const SITE_NOT_CONNECTED_EVENT = 'webmaven:site-not-connected';

// WordPress REST API service
export class APIService {
  constructor() {
    this.WEBMAVEN_WP_DATA = window.WEBMAVEN_WP_DATA;
  }

  /**
   * An API 401 (or 403) on a proxied call is NOT a sign-out (1.2.9): a route
   * that does not take the site's token answers 401 while the site is
   * perfectly connected, and treating it as a logout put the owner on the
   * Sign In screen in a loop. Only the plugin's own "this site is not
   * connected" answer (code wpmaven_site_not_connected) asks AuthContext to
   * re-read /status, and /status alone decides whether Sign In shows.
   */
  _handleResponse(response) {
    if (response && (response.status === 409 || response.status === 401) && typeof response.clone === 'function') {
      response.clone().json().then((body) => {
        if (body && body.code === SITE_NOT_CONNECTED_CODE) {
          window.dispatchEvent(new CustomEvent(SITE_NOT_CONNECTED_EVENT));
        }
      }).catch(() => {});
    }
    return response;
  }

  async get(path) {
    // Handle query parameters properly for both pretty and non-pretty permalinks
    let url;
    if (path.includes('?')) {
      const [pathPart, queryPart] = path.split('?');
      // Use & if restUrl already has ?, otherwise use ?
      const separator = this.WEBMAVEN_WP_DATA.restUrl.includes('?') ? '&' : '?';
      url = `${this.WEBMAVEN_WP_DATA.restUrl}${pathPart}${separator}${queryPart}`;
    } else {
      url = `${this.WEBMAVEN_WP_DATA.restUrl}${path}`;
    }
    const traceId = generateTraceId();
    const response = await fetch(url, {
      headers: { "X-WP-Nonce": this.WEBMAVEN_WP_DATA.nonce, "X-Trace-Id": traceId },
    });
    this._handleResponse(response);
    return response.json();
  }

  async post(path, body) {
    try {
      // Clean body to remove any non-serializable values
      const cleanBody = this._cleanObject(body);
      const bodyString = JSON.stringify(cleanBody || {});

      const traceId = generateTraceId();
      const response = await fetch(`${this.WEBMAVEN_WP_DATA.restUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": this.WEBMAVEN_WP_DATA.nonce,
          "X-Trace-Id": traceId
        },
        body: bodyString,
      });
      this._handleResponse(response);
      return response.json();
    } catch (error) {
      console.error('API POST error:', error, 'path:', path, 'body:', body);
      throw error;
    }
  }

  _cleanObject(obj, seen = new WeakSet()) {
    if (obj === null || obj === undefined) {
      return {};
    }
    
    if (typeof obj !== 'object') {
      return obj;
    }
    
    // Check for circular references
    if (seen.has(obj)) {
      return undefined; // Return undefined for circular references
    }
    seen.add(obj);
    
    if (Array.isArray(obj)) {
      return obj.map(item => this._cleanObject(item, seen)).filter(item => item !== undefined);
    }
    
    const cleaned = {};
    
    for (const key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      
      const value = obj[key];
      
      // Skip functions and undefined
      if (typeof value === 'function' || value === undefined) {
        continue;
      }
      
      // Recursively clean nested objects
      if (typeof value === 'object' && value !== null) {
        const cleanedValue = this._cleanObject(value, seen);
        if (cleanedValue !== undefined) {
          cleaned[key] = cleanedValue;
        }
      } else {
        cleaned[key] = value;
      }
    }
    
    return cleaned;
  }

  async put(path, body) {
    try {
      const cleanBody = this._cleanObject(body);
      const bodyString = JSON.stringify(cleanBody || {});

      const response = await fetch(`${this.WEBMAVEN_WP_DATA.restUrl}${path}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-WP-Nonce": this.WEBMAVEN_WP_DATA.nonce
        },
        body: bodyString,
      });
      this._handleResponse(response);
      return response.json();
    } catch (error) {
      console.error('API PUT error:', error, 'path:', path, 'body:', body);
      throw error;
    }
  }

  async del(path) {
    const response = await fetch(`${this.WEBMAVEN_WP_DATA.restUrl}${path}`, {
      method: "DELETE",
      headers: { "X-WP-Nonce": this.WEBMAVEN_WP_DATA.nonce },
    });
    this._handleResponse(response);
    return response.json();
  }

  async getSSEConfig() {
    return this.get('/sse/config');
  }

  /**
   * SECURITY: Get a short-lived SSE ticket.
   * This keeps the JWT server-side - only a 30-second single-use ticket is exposed.
   */
  async getSSETicket(conversationId, instanceId = null) {
    return this.post('/sse/ticket', { conversationId, instanceId });
  }

  /** GET /status; `refresh` asks the plugin to read the site state again now (administrators, at most every 30 seconds). */
  async getPluginStatus(options = {}) {
    return this.get(options && options.refresh ? '/status?refresh=1' : '/status');
  }

  // SSE Agent methods
  /**
   * Starts a chat turn. A refused turn (the site's hourly chat limit, a lost
   * link, WPMaven out of reach) throws ChatTurnRefused with the sentence to
   * show: its answer never comes on the stream, so the panel must not wait.
   */
  async executeAgentViaSSE(prompt, conversationId, instanceId = null, context = {}) {
    const bodyString = JSON.stringify(this._cleanObject({ prompt, conversationId, instanceId, context }) || {});
    const response = await fetch(`${this.WEBMAVEN_WP_DATA.restUrl}/backend/agent/sse/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": this.WEBMAVEN_WP_DATA.nonce,
        "X-Trace-Id": generateTraceId()
      },
      body: bodyString,
    });
    this._handleResponse(response);
    const body = await response.json().catch(() => null);
    if (!response.ok || (body && body.success === false)) {
      throw refusedTurn(response.status, body);
    }
    return body;
  }

  /**
   * The owner's yes or no to a step that waits for it. `modifiedParameters`
   * carries the preview picked on a change's card ({ previewId }). Throws when
   * the answer did not go through: the chat keeps the card open and says so.
   */
  async sendApprovalViaSSE(stepId, conversationId, approved, modifiedParameters = null, comment = null) {
    const response = await fetch(`${this.WEBMAVEN_WP_DATA.restUrl}/backend/agent/sse/approval/${encodeURIComponent(stepId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WP-Nonce": this.WEBMAVEN_WP_DATA.nonce,
        "X-Trace-Id": generateTraceId()
      },
      body: JSON.stringify(this._cleanObject({ conversationId, approved, modifiedParameters, comment }) || {}),
    });
    this._handleResponse(response);
    const body = await response.json().catch(() => null);
    if (!response.ok || (body && body.success === false)) {
      throw new Error(`The answer did not go through (${response.status}).`);
    }
    return body;
  }

  async logout() {
    return this.post('/logout');
  }

  /**
   * A link token for this administrator's Sign In (1.2.14): the site only
   * accepts the credentials WPMaven sends back when they carry it.
   * Answers { success, linkToken, expiresIn }; administrators only.
   */
  async startLink() {
    return this.post('/link/start');
  }

  // Conversations API methods
  // editorKind (2026-10-18): the editor's chat of one editor, 'post' or
  // 'product'; none is the page editor's. Only with clientType 'editor'.
  async listConversations(page = 1, limit = 5, clientType = null, editorKind = null) {
    const qs = `page=${page}&limit=${limit}` + (clientType ? `&clientType=${encodeURIComponent(clientType)}` : '')
      + (editorKind ? `&editorKind=${encodeURIComponent(editorKind)}` : '');
    return this.get(`/conversations?${qs}`);
  }

  async getLatestConversation(clientType = null, editorKind = null) {
    const params = [clientType ? `clientType=${encodeURIComponent(clientType)}` : '', editorKind ? `editorKind=${encodeURIComponent(editorKind)}` : ''].filter(Boolean);
    return this.get(`/conversations/latest${params.length ? `?${params.join('&')}` : ''}`);
  }

  async createConversation(title = 'New chat', clientType = null, editorKind = null) {
    // Ensure title is a string, not an object or null
    const titleStr = title && typeof title === 'string' ? title : (title || 'New chat');
    const body = { title: titleStr };
    if (clientType) body.clientType = clientType;
    if (editorKind) body.editorKind = editorKind;
    return this.post('/conversations', body);
  }

  /** One page of a conversation's messages, newest first (page 1 is the newest). */
  async getMessages(conversationId, page = 1, limit = 20) {
    return this.get(`/messages?conversationId=${encodeURIComponent(conversationId)}&page=${page}&limit=${limit}`);
  }
}

// Create singleton instance
export const api = new APIService();
