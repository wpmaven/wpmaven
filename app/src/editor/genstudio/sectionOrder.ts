import type { EditOperation } from '../../types/edits';

/** A move of one section above (before) or below (after) another one. */
export type SectionMove = Extract<EditOperation, { op: 'move_section' }>;

/** The section ids of a page once these moves applied, in order (an unknown id leaves the order as it was). */
export function orderAfterMoves(ids: string[], moves: SectionMove[]): string[] {
  let order = [...ids];
  for (const m of moves) {
    const anchor = m.before ?? m.after;
    if (!order.includes(m.sectionId) || !anchor || !order.includes(anchor) || anchor === m.sectionId) continue;
    const rest = order.filter((id) => id !== m.sectionId);
    const at = rest.indexOf(anchor) + (m.before ? 0 : 1);
    order = [...rest.slice(0, at), m.sectionId, ...rest.slice(at)];
  }
  return order;
}

/** The move that puts a section one place up or down in this order, or null at the ends. */
export function stepMove(page: string, order: string[], sectionId: string, direction: 'up' | 'down'): SectionMove | null {
  const i = order.indexOf(sectionId);
  if (i < 0) return null;
  if (direction === 'up') return i > 0 ? { op: 'move_section', page, sectionId, before: order[i - 1] } : null;
  return i < order.length - 1 ? { op: 'move_section', page, sectionId, after: order[i + 1] } : null;
}

/** The move a drop asks for: the dragged section lands where the target is (above it when it came from below). */
export function dropMove(page: string, order: string[], dragged: string, target: string): SectionMove | null {
  const from = order.indexOf(dragged);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return null;
  return from > to ? { op: 'move_section', page, sectionId: dragged, before: target } : { op: 'move_section', page, sectionId: dragged, after: target };
}
