import React from 'react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, total, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="wpm-pagination">
      <span className="wpm-pagination__info">{total} item{total !== 1 ? 's' : ''}</span>
      <div className="wpm-pagination__controls">
        <button
          className="wpm-pagination__btn"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          Previous
        </button>
        <span className="wpm-pagination__current">
          Page {currentPage} of {totalPages}
        </span>
        <button
          className="wpm-pagination__btn"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}
