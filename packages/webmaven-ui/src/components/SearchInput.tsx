import React, { type InputHTMLAttributes, forwardRef } from 'react';
import { SearchIcon } from '../icons';
import s from './SearchInput.module.css';

export type SearchInputProps = InputHTMLAttributes<HTMLInputElement>;

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, ...props }, ref) => (
    <div className={`${s.container}${className ? ` ${className}` : ''}`}>
      <span className={s.icon}>
        <SearchIcon size={16} />
      </span>
      <input ref={ref} className={s.input} type="text" {...props} />
    </div>
  ),
);

SearchInput.displayName = 'SearchInput';
