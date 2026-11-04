import { useEffect, useCallback, useRef } from 'react';

export interface IframeMessage {
	type: string;
	payload: Record<string, unknown>;
}

type MessageHandler = (payload: Record<string, unknown>) => void;

declare const wmeConfig: {
	siteOrigin?: string;
	siteUrl: string;
	restUrl: string;
	nonce: string;
	postId: number;
	pluginUrl: string;
	adminUrl: string;
	hasApiKey: boolean;
	settingsUrl: string;
};

/**
 * Hook for bidirectional postMessage communication with the site iframe.
 * Validates message origin against the known site origin.
 */
export function useIframeMessages(handlers: Record<string, MessageHandler>) {
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	// Derive the expected origin from siteOrigin or siteUrl.
	const expectedOrigin = wmeConfig.siteOrigin || new URL(wmeConfig.siteUrl).origin;

	useEffect(() => {
		function onMessage(event: MessageEvent) {
			// Validate origin — only accept messages from our WordPress site.
			if (event.origin !== expectedOrigin && event.origin !== window.location.origin) {
				return;
			}

			const data = event.data as IframeMessage;
			if (!data?.type) return;

			const handler = handlersRef.current[data.type];
			if (handler) {
				handler(data.payload);
			}
		}

		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [expectedOrigin]);

	const sendToIframe = useCallback((type: string, payload: Record<string, unknown> = {}) => {
		const iframe = iframeRef.current;
		if (!iframe?.contentWindow) return;
		iframe.contentWindow.postMessage({ type, payload }, expectedOrigin);
	}, [expectedOrigin]);

	const setIframeRef = useCallback((el: HTMLIFrameElement | null) => {
		iframeRef.current = el;
	}, []);

	return { sendToIframe, setIframeRef, iframeRef };
}
