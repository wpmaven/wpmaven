/**
 * API service: wraps REST calls to the WebMaven backend.
 */

declare const wmeConfig: {
	siteUrl: string;
	restUrl: string;
	nonce: string;
	postId: number;
	pluginUrl: string;
	adminUrl: string;
	siteOrigin: string;
	hasApiKey: boolean;
	settingsUrl: string;
	instanceId: string;
};

interface ApplyChangeParams {
	targetType: string;
	postId: number | string;
	blockUid: string;
	newContent: string;
	description?: string;
	// ACF-specific.
	fieldKey?: string;
	// Elementor-specific.
	widgetId?: string;
	// Divi-specific.
	moduleType?: string;
	moduleIndex?: number;
	// Global style-specific.
	changeType?: string;
	changes?: Record<string, unknown>;
}

interface AIPromptParams {
	prompt: string;
	elementContext: Record<string, unknown>;
	conversation?: Array<{ role: string; content: string }>;
}

interface AIResponse {
	result: string;
	new_content: string;
	explanation: string;
}

interface Checkpoint {
	id: number;
	post_id: number;
	description: string;
	timestamp: number;
	date: string;
	author: string;
}

export interface PageItem {
	id: number;
	title: string;
	type: string;
	url: string;
}

/**
 * A failed editor request. The message is the reason in plain words; a
 * failed publish also says which change failed and whether the site was put
 * back as it was ({ error, code, failed_index, reverted }).
 */
export class ApiError extends Error {
	status: number;
	code?: string;
	failedIndex: number | null;
	reverted?: boolean;

	constructor(message: string, status: number, body: Record<string, unknown> = {}) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = typeof body.code === 'string' && body.code !== '' ? body.code : undefined;
		const index = body.failed_index;
		this.failedIndex = typeof index === 'number' ? index : (typeof index === 'string' && /^\d+$/.test(index) ? Number(index) : null);
		this.reverted = typeof body.reverted === 'boolean' ? body.reverted : undefined;
	}
}

/** HTML (a WordPress error can carry markup and entities) as plain words. */
export function plainText(html: string): string {
	const noTags = html.replace(/<[^>]*>/g, ' ');
	let decoded = noTags;
	if (typeof document !== 'undefined') {
		const el = document.createElement('textarea');
		el.innerHTML = noTags;
		decoded = el.value;
	}
	return decoded.replace(/\s+/g, ' ').trim();
}

/**
 * The reason an error body gives: the editor's own `error`, else WordPress's
 * `message` (REST errors and the critical error page), tags stripped.
 */
export function errorMessageFrom(body: unknown, status: number): string {
	const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
	for (const key of ['error', 'message']) {
		const value = b[key];
		if (typeof value === 'string') {
			const text = plainText(value);
			if (text !== '') return text;
		}
	}
	return `Server error (${status})`;
}

/**
 * Fetch with timeout, nonce, and user-friendly error handling.
 */
async function apiFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
	// Ensure trailing slash on restUrl.
	const base = wmeConfig.restUrl.endsWith('/') ? wmeConfig.restUrl : wmeConfig.restUrl + '/';
	const url = base + endpoint;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 45000);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': wmeConfig.nonce,
				...(options.headers || {}),
			},
		});

		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
			throw new ApiError(errorMessageFrom(fields, response.status), response.status, fields);
		}

		return response.json();
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			throw new Error('Request timed out. Please try again.');
		}
		if (err instanceof TypeError && err.message === 'Failed to fetch') {
			throw new Error('Network error. Check your connection and try again.');
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}
}




// ─── Checkpoints ───




export function getSiteUrl(): string {
	const base = wmeConfig.siteUrl;
	// Always append webmaven_discover=1 so the discovery script runs in the iframe
	const url = new URL(base);
	url.searchParams.set('webmaven_discover', '1');
	return url.toString();
}

export function getPostId(): number {
	return wmeConfig.postId;
}

export function getAdminUrl(): string {
	return wmeConfig.adminUrl || '/wp-admin/';
}

export function hasApiKey(): boolean {
	return wmeConfig.hasApiKey;
}

/* ── SEO ────────────────────────────────────────────────────────────── */

export interface SEOData {
	meta_title: string;
	meta_description: string;
	og_title: string;
	og_description: string;
	og_image: string;
	post_title: string;
	post_excerpt: string;
	word_count: number;
}

export async function getSEOData(postId: number): Promise<SEOData> {
	return apiFetch(`seo/${postId}`);
}


