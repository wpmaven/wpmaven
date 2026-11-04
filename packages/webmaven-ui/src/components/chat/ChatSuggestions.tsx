import React, { useState, type ReactNode } from 'react';
import { Button } from '../Button';
import { Tabs } from '../Tabs';
import s from './ChatSuggestions.module.css';

/**
 * One suggestion: `send` chips send their sentence as it is; `fill` chips
 * have [bracketed] parts the owner fills in, so they seed the input (it
 * turns the brackets into slots).
 */
export interface ChatSuggestion {
  text: string;
  mode: 'send' | 'fill';
  icon?: ReactNode;
}

export interface ChatSuggestionCategory {
  id: string;
  label: string;
  icon?: ReactNode;
  suggestions: ChatSuggestion[];
}

export interface ChatSuggestionsProps {
  /** The app's own chips (the plugin's are gated by the site's state). A category with none is left out. */
  categories: ChatSuggestionCategory[];
  /** The line above ("Try asking me to…"). */
  heading?: ReactNode;
  /** Drawn beside the heading: the Co-CEO's face, so the owner sees who they talk to before writing. */
  lead?: ReactNode;
  /** A `send` chip: the sentence goes out as it is. */
  onSend: (text: string) => void;
  /** A `fill` chip: the input takes the sentence, its [brackets] to fill in. */
  onFill: (text: string) => void;
  disabled?: boolean;
  /** The category open first (the first one by default). */
  defaultCategory?: string;
  className?: string;
}

/** The sentence with its [bracketed] parts drawn as the words to fill in (brackets left out). */
export function suggestionParts(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={`v-${key++}`} className={s.slot}>
        {m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/**
 * The empty chat's suggestions (2026-10-16), the plugin's layout: a heading,
 * category tabs (the kit's segmented Tabs) and the active category's chips.
 * The data is the app's.
 */
export const ChatSuggestions: React.FC<ChatSuggestionsProps> = ({
  categories: all,
  heading = 'Try asking me to…',
  lead,
  onSend,
  onFill,
  disabled = false,
  defaultCategory,
  className = '',
}) => {
  const categories = all.filter((c) => c.suggestions.length > 0);
  const [activeId, setActiveId] = useState(defaultCategory ?? categories[0]?.id ?? '');
  const active = categories.find((c) => c.id === activeId) ?? categories[0];
  if (!active) return null;

  const pick = (suggestion: ChatSuggestion) => {
    if (disabled) return;
    if (suggestion.mode === 'send') onSend(suggestion.text);
    else onFill(suggestion.text);
  };

  return (
    <div className={`${s.root} ${className}`} data-testid="chat-suggestions">
      <div className={s.head}>
        {lead && (
          <span className={s.lead} data-testid="prompt-lead">
            {lead}
          </span>
        )}
        <span className={s.heading}>{heading}</span>
      </div>

      {categories.length > 1 && (
        <Tabs
          look="segmented"
          size="sm"
          ariaLabel="Suggestions"
          items={categories.map((c) => ({ key: c.id, label: c.label, icon: c.icon }))}
          activeKey={active.id}
          onChange={setActiveId}
          className={s.tabs}
        />
      )}

      <div className={s.chips} role="group" aria-label={active.label}>
        {active.suggestions.map((suggestion, i) => (
          <Button
            key={`${active.id}-${i}`}
            data-testid="prompt-chip"
            data-mode={suggestion.mode}
            variant="outline"
            size="sm"
            disabled={disabled}
            leftIcon={suggestion.icon}
            onClick={() => pick(suggestion)}
            title={suggestion.mode === 'fill' ? 'Fill in the highlighted words' : 'Send this'}
            className={s.chip}
          >
            {suggestionParts(suggestion.text)}
          </Button>
        ))}
      </div>
    </div>
  );
};
