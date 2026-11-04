import { WPPost, WPPage, WPComment, WPUser, WPMedia, PaginatedResponse } from '../types/wpContent';
import { storeApi } from './storeApi';

interface WPDataGlobal {
  site?: { url: string };
  nonce?: string;
  /** get_rest_url(null, 'wp/v2'): the REST base WordPress itself reports. */
  wpRestUrl?: string;
  /** get_rest_url(null, 'webmaven_wp/v1'). */
  restUrl?: string;
}

/**
 * WordPress's own REST base for wp/v2, as the plugin hands it over. It is
 * never built from the site's address: with plain permalinks the REST API
 * lives at ?rest_route=, and the site address can differ from the admin's.
 * Older pages without it derive it from the plugin's own REST base.
 */
export function wpRestBase(wpData: WPDataGlobal | undefined): string {
  if (wpData?.wpRestUrl) return wpData.wpRestUrl.replace(/\/+$/, '');
  if (wpData?.restUrl && wpData.restUrl.includes('webmaven_wp/v1')) {
    return wpData.restUrl.replace('webmaven_wp/v1', 'wp/v2').replace(/\/+$/, '');
  }
  const siteUrl = wpData?.site?.url || window.location.origin;
  return `${siteUrl}/wp-json/wp/v2`;
}

/** An endpoint ("/posts?per_page=1") on a base, whether the base carries a query (?rest_route=) or not. */
export function wpRestUrl(base: string, endpoint: string): string {
  const [path, query] = endpoint.split('?');
  const url = `${base}${path}`;
  if (!query) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${query}`;
}

class WPApiService {
  private baseUrl: string;
  private nonce: string;

  constructor() {
    const wpData = (window as any).WEBMAVEN_WP_DATA as WPDataGlobal | undefined;
    this.baseUrl = wpRestBase(wpData);
    this.nonce = wpData?.nonce || '';
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'X-WP-Nonce': this.nonce,
      ...((options.headers as Record<string, string>) || {}),
    };

    if (options.body && typeof options.body === 'string') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(wpRestUrl(this.baseUrl, endpoint), {
      ...options,
      headers,
      credentials: 'same-origin',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(error.message || `API error: ${response.status}`);
    }

    // Extract pagination headers
    const total = parseInt(response.headers.get('X-WP-Total') || '0', 10);
    const totalPages = parseInt(response.headers.get('X-WP-TotalPages') || '0', 10);

    const data = await response.json();

    // Attach pagination metadata
    if (Array.isArray(data)) {
      (data as any).__total = total;
      (data as any).__totalPages = totalPages;
    }

    return data;
  }

  // Posts
  async getPosts(params: { page?: number; per_page?: number; status?: string; search?: string; _embed?: boolean; _fields?: string } = {}): Promise<PaginatedResponse<WPPost>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.status) searchParams.set('status', params.status);
    if (params.search) searchParams.set('search', params.search);
    if (params._embed !== false) searchParams.set('_embed', '1');
    if (params._fields) searchParams.set('_fields', params._fields);

    const qs = searchParams.toString();
    const data = await this.request<WPPost[]>(`/posts${qs ? '?' + qs : ''}`);
    return {
      items: data,
      total: (data as any).__total || data.length,
      totalPages: (data as any).__totalPages || 1,
    };
  }

  // Pages
  async getPages(params: { page?: number; per_page?: number; status?: string; search?: string; _embed?: boolean; _fields?: string } = {}): Promise<PaginatedResponse<WPPage>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.status) searchParams.set('status', params.status);
    if (params.search) searchParams.set('search', params.search);
    if (params._embed !== false) searchParams.set('_embed', '1');
    if (params._fields) searchParams.set('_fields', params._fields);

    const qs = searchParams.toString();
    const data = await this.request<WPPage[]>(`/pages${qs ? '?' + qs : ''}`);
    return {
      items: data,
      total: (data as any).__total || data.length,
      totalPages: (data as any).__totalPages || 1,
    };
  }

  // Comments
  async getComments(params: { page?: number; per_page?: number; status?: string } = {}): Promise<PaginatedResponse<WPComment>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.status) searchParams.set('status', params.status);

    const qs = searchParams.toString();
    const data = await this.request<WPComment[]>(`/comments${qs ? '?' + qs : ''}`);
    return {
      items: data,
      total: (data as any).__total || data.length,
      totalPages: (data as any).__totalPages || 1,
    };
  }

  async updateCommentStatus(id: number, status: string): Promise<WPComment> {
    return this.request<WPComment>(`/comments/${id}`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  }

  // Users
  async getUsers(params: { page?: number; per_page?: number; roles?: string } = {}): Promise<PaginatedResponse<WPUser>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.roles) searchParams.set('roles', params.roles);

    const qs = searchParams.toString();
    const data = await this.request<WPUser[]>(`/users${qs ? '?' + qs : ''}`);
    return {
      items: data,
      total: (data as any).__total || data.length,
      totalPages: (data as any).__totalPages || 1,
    };
  }

  // Media
  async getMedia(params: { page?: number; per_page?: number; search?: string; media_type?: string; mime_type?: string } = {}): Promise<PaginatedResponse<WPMedia>> {
    const searchParams = new URLSearchParams();
    if (params.page) searchParams.set('page', String(params.page));
    if (params.per_page) searchParams.set('per_page', String(params.per_page));
    if (params.search) searchParams.set('search', params.search);
    if (params.media_type) searchParams.set('media_type', params.media_type);
    if (params.mime_type) searchParams.set('mime_type', params.mime_type);

    const qs = searchParams.toString();
    const data = await this.request<WPMedia[]>(`/media${qs ? '?' + qs : ''}`);
    return {
      items: data,
      total: (data as any).__total || data.length,
      totalPages: (data as any).__totalPages || 1,
    };
  }

  /**
   * Deletes a media file through the plugin's guarded route, never wp/v2
   * with force: a file still used on the site (a page, a product, the logo)
   * is refused with where it is used.
   */
  async deleteMedia(id: number): Promise<void> {
    await storeApi.deleteMedia(id);
  }

  // Write operations for posts/pages
  async deletePost(id: number): Promise<void> {
    await this.request(`/posts/${id}`, { method: 'DELETE' });
  }

  async deletePage(id: number): Promise<void> {
    await this.request(`/pages/${id}`, { method: 'DELETE' });
  }

  async deleteComment(id: number): Promise<void> {
    await this.request(`/comments/${id}`, { method: 'DELETE' });
  }
}

export const wpApi = new WPApiService();
