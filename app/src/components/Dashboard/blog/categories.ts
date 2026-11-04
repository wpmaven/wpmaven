/**
 * The blog's categories (wp/v2/categories), read once per page load and
 * shared by the Blog's quick edits.
 */

import { wpRest } from '../../../services/wpRest';
import { decodeHtmlEntities } from '../../../utils/text';

export interface BlogCategory {
  id: number;
  name: string;
}

let read: Promise<BlogCategory[]> | null = null;

export function loadBlogCategories(force = false): Promise<BlogCategory[]> {
  if (!read || force) {
    read = wpRest.get<Array<Record<string, any>>>('wp/v2/categories', { query: { per_page: 100, _fields: 'id,name' } })
      .then((answer) => (Array.isArray(answer.data) ? answer.data : [])
        .filter((c) => Number(c.id) > 0)
        .map((c) => ({ id: Number(c.id), name: decodeHtmlEntities(String(c.name ?? '')) })))
      .catch((error) => {
        read = null;
        throw error;
      });
  }
  return read;
}
