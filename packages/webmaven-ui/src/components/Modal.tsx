import React, { useEffect, useRef, useCallback, useId } from 'react';
import { KIT_COPY } from '../lib/kitCopy';
import s from './Modal.module.css';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeMap = { sm: 384, md: 448, lg: 512, xl: 576 };

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, description, children, size = 'md' }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // The panel is a modal dialog named by its title and described by its
  // description, when it has them (screen readers announce both on open).
  const id = useId();
  const titleId = `${id}title`;
  const descriptionId = `${id}description`;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
        document.body.style.overflow = '';
      };
    }
  }, [isOpen, handleKeyDown]);

  useEffect(() => {
    if (isOpen) panelRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className={s.overlay} onClick={onClose}>
      <div
        ref={panelRef}
        className={s.panel}
        style={{ maxWidth: sizeMap[size] }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.header}>
          <div>
            {title && <h3 id={titleId} className={s.title}>{title}</h3>}
            {description && <p id={descriptionId} className={s.description}>{description}</p>}
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label={KIT_COPY.modal.close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={s.body}>{children}</div>
      </div>
    </div>
  );
};
