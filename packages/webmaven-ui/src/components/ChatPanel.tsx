import React, { type ReactNode, type RefObject } from 'react';
import { ChevronDownIcon, PlusIcon } from '../icons';
import { Button } from './Button';
import { ChatInput } from './ChatInput';
import { Loader } from './Loader';
import s from './ChatPanel.module.css';

export interface ChatPanelStatus {
  type: 'connecting' | 'error' | 'disconnected' | 'connected';
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
  attempt?: number;
  maxAttempts?: number;
}

export interface ChatPanelProps {
  title?: string;
  children: ReactNode;
  sidebar?: boolean;
  accent?: boolean;
  /** Pulsing glow + animated gradient border when active (e.g. pipeline running) */
  active?: boolean;

  // Input
  onSend?: (msg: string) => void;
  onAttach?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Optional controlled value for the input (parent owns text state). */
  value?: string;
  /** Called on every keystroke when controlled. */
  onChange?: (text: string) => void;
  /** External seed for the input. Re-applied whenever `seedToken` changes. */
  seedText?: string;
  /** Bump this number to (re)apply `seedText`. */
  seedToken?: number;

  // Header
  onNewChat?: () => void;
  conversations?: Array<{ id: string; title: string }>;
  activeConversationId?: string;
  onSelectConversation?: (id: string) => void;

  // Scroll
  messagesEndRef?: RefObject<HTMLDivElement>;
  messagesContainerRef?: RefObject<HTMLDivElement>;
  onScroll?: (e: React.UIEvent) => void;
  showScrollToBottom?: boolean;
  onScrollToBottom?: () => void;

  // Loading
  loading?: boolean;
  loadingMore?: boolean;

  // Connection status
  status?: ChatPanelStatus;

  // Slots
  emptyState?: ReactNode;
  footerExtra?: ReactNode;

  className?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  title = 'AI Assistant',
  children,
  sidebar,
  accent,
  active,
  onSend,
  onAttach,
  placeholder = 'Ask me anything...',
  disabled = false,
  value,
  onChange,
  seedText,
  seedToken,
  onNewChat,
  conversations,
  activeConversationId,
  onSelectConversation,
  messagesEndRef,
  messagesContainerRef,
  onScroll,
  showScrollToBottom,
  onScrollToBottom,
  loading,
  loadingMore,
  status,
  emptyState,
  footerExtra,
  className = '',
}) => {
  const hasMessages = React.Children.count(children) > 0;
  const activeConv = conversations?.find(c => c.id === activeConversationId);
  const showFullStatus = status && status.type !== 'connected' && !hasMessages;
  const showBannerStatus = status && status.type !== 'connected' && hasMessages;

  const panelCls = [s.panel, sidebar && s.sidebar, accent && s.accent, active && s.active, className].filter(Boolean).join(' ');

  const panel = (
    <div className={panelCls}>
      {/* Header */}
      <div className={s.header}>
        <h4 className={s.title}>{title}</h4>
        <div className={s.headerRight}>
          {conversations && conversations.length > 1 && (
            <button className={s.chatSwitch}>
              {activeConv?.title || 'Chat'}
              <ChevronDownIcon size={12} />
              <select
                value={activeConversationId || ''}
                onChange={e => onSelectConversation?.(e.target.value)}
              >
                {conversations.map(c => (
                  <option key={c.id} value={c.id}>{c.title || 'Untitled'}</option>
                ))}
              </select>
            </button>
          )}
          {onNewChat && (
            <Button variant="icon" onClick={onNewChat} style={{ width: 28, height: 28 }}>
              <PlusIcon size={14} />
            </Button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div
        className={s.messages}
        ref={messagesContainerRef as any}
        onScroll={onScroll}
      >
        {/* Loading more (pagination) */}
        {loadingMore && (
          <div className={s.loadingMore}>Loading more messages...</div>
        )}

        {/* Banner status (when has messages) */}
        {showBannerStatus && (
          <div className={`${s.statusBanner} ${s[`status_${status!.type}`]}`}>
            <span>{status!.message}</span>
            {status!.onRetry && (
              <button className={s.statusRetry} onClick={status!.onRetry}>
                {status!.retryLabel || 'Retry'}
              </button>
            )}
          </div>
        )}

        {/* Full status (when no messages) */}
        {showFullStatus && (
          <div className={s.statusFull}>
            {status!.type === 'connecting' && <Loader size={32} />}
            <span className={s.statusText}>
              {status!.message}
              {status!.attempt != null && status!.attempt > 0 && status!.maxAttempts && (
                <span className={s.statusAttempt}> (attempt {status!.attempt}/{status!.maxAttempts})</span>
              )}
            </span>
            {status!.onRetry && (
              <button className={s.statusRetryBtn} onClick={status!.onRetry}>
                {status!.retryLabel || 'Retry'}
              </button>
            )}
          </div>
        )}

        {/* Initial loading */}
        {loading && !hasMessages && !showFullStatus && (
          <div className={s.statusFull}>
            <Loader size={32} />
          </div>
        )}

        {/* Empty state */}
        {!loading && !hasMessages && !showFullStatus && emptyState}

        {/* Messages */}
        {children}

        {/* Footer extra (e.g. ThinkingIndicator) */}
        {footerExtra}

        {/* Scroll anchor */}
        {messagesEndRef && <div ref={messagesEndRef as any} />}

        {/* Scroll to bottom */}
        {showScrollToBottom && (
          <button className={s.scrollBtn} onClick={onScrollToBottom}>
            New messages
          </button>
        )}
      </div>

      {/* Input */}
      <div className={s.footer}>
        <ChatInput
          placeholder={placeholder}
          onSend={onSend}
          onAttach={onAttach}
          disabled={disabled}
          value={value}
          onChange={onChange}
          seedText={seedText}
          seedToken={seedToken}
        />
      </div>
    </div>
  );

  if (active) {
    return <div className={s.glowWrap}>{panel}</div>;
  }

  return panel;
};
