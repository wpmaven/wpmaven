import React from 'react';
import type { PageScreens } from './types';

/**
 * A screen loaded as its own chunk when it opens (PageRouter waits for it).
 * Wrapped in a plain component so the registry holds components of one
 * kind, whatever the loader.
 */
function lazyScreen(load: () => Promise<{ default: React.ComponentType }>): React.ComponentType {
  const Lazy = React.lazy(load);
  const Screen = () => <Lazy />;
  return Screen;
}

/** The components of store.routes.tsx, by page id. */
export const STORE_SCREENS: PageScreens = {
  store: lazyScreen(() => import(/* webpackChunkName: "wm-store" */ '../../store/StoreScreen')),
  blog: lazyScreen(() => import(/* webpackChunkName: "wm-blog" */ '../../blog/BlogScreen')),
  media: lazyScreen(() => import(/* webpackChunkName: "wm-media" */ '../../media/MediaScreen')),
  messages: lazyScreen(() => import(/* webpackChunkName: "wm-messages" */ '../../messages/MessagesScreen')),
};
