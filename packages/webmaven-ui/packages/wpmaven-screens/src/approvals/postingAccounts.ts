/**
 * Which accounts a post goes out as:
 * the API's sentence on each approval, "On Instagram as @coppersmith and on
 * Facebook as Copper Kettle.", so a post headed for another business's
 * Instagram is seen before the yes. The same sentence the WhatsApp ask
 * shows. Null for anything that is not a post to Instagram or Facebook.
 *
 * Shown only before it goes out: the API reads the accounts connected now,
 * which after a Page switch are not the ones an old post went out as.
 */
import type { ApprovalStatus, OperatorApproval } from './types';

const NOT_OUT_YET: ReadonlySet<ApprovalStatus> = new Set<ApprovalStatus>(['PENDING', 'NEEDS_ACTIONS', 'APPROVED']);

export function postingAccountsShown(approval: Partial<Pick<OperatorApproval, 'status' | 'postingAccounts'>>): string | null {
  const line = typeof approval.postingAccounts === 'string' ? approval.postingAccounts.trim() : '';
  if (!line) return null;
  if (approval.status && !NOT_OUT_YET.has(approval.status)) return null;
  return line;
}
