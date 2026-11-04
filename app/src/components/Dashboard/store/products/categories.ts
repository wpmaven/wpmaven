/**
 * The store's product categories (wc/v3/products/categories), read once per
 * page load and shared by the grid's filter and the editor.
 */

import { wpRest } from '../../../../services/wpRest';
import { decodeHtmlEntities } from '../../../../utils/text';
import type { StoreCategory } from '../../../../types/store';

let read: Promise<StoreCategory[]> | null = null;

export function loadCategories(force = false): Promise<StoreCategory[]> {
  if (!read || force) {
    read = wpRest.get<Array<Record<string, any>>>('wc/v3/products/categories', { query: { per_page: 100, _fields: 'id,name,parent,count' } })
      .then((answer) => (Array.isArray(answer.data) ? answer.data : []).map((c) => ({
        id: Number(c.id),
        name: decodeHtmlEntities(String(c.name ?? '')),
        parent: Number(c.parent) || 0,
        count: Number(c.count) || 0,
      })))
      .catch((error) => {
        read = null;
        throw error;
      });
  }
  return read;
}

/** Tests: read the categories again. */
export function resetCategoriesForTests(): void {
  read = null;
}
