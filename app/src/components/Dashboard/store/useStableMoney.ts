import { useRef } from 'react';
import type { StoreMoneyFormat } from '../../../types/store';

const same = (a: StoreMoneyFormat, b: StoreMoneyFormat) => a.code === b.code && a.symbol === b.symbol
  && a.position === b.position && a.decimals === b.decimals && a.thousandSep === b.thousandSep && a.decimalSep === b.decimalSep;

/**
 * The store's money format as one object while it stays the same: the page
 * data gives a first copy and the store context a second one, which must not
 * read a list again or reset a form the owner started.
 */
export function useStableMoney(money: StoreMoneyFormat): StoreMoneyFormat {
  const kept = useRef(money);
  if (!same(kept.current, money)) kept.current = money;
  return kept.current;
}
