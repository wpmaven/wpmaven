import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  KeyboardEvent,
  ChangeEvent,
  ClipboardEvent,
  FormEvent,
} from 'react';
import { PaperclipIcon } from '../icons';
import { NavIcon } from '../icons/NavIcon';
import { Button } from './Button';
import { KIT_COPY, KIT_COPY_EN } from '../lib/kitCopy';
import s from './ChatInput.module.css';

export interface ChatInputProps {
  placeholder?: string;
  onSend?: (message: string) => void;
  onAttach?: () => void;
  maxHeight?: number;
  disabled?: boolean;

  // ── Controlled mode (opt-in) ──────────────────────────────────────
  /** Optional controlled value for the free-text textarea. */
  value?: string;
  /** Called on every keystroke in controlled mode. Also called on send-clear. */
  onChange?: (text: string) => void;

  // ── Seed (works in either mode) ───────────────────────────────────
  /**
   * Text to fill the input with. If the text contains `[bracketed]`
   * placeholders, the input switches to template mode and renders inline
   * editable slots for each bracket. Otherwise it fills the textarea.
   * Re-applied whenever `seedToken` changes.
   */
  seedText?: string;
  /** Bump this number to (re)apply `seedText`. Same value = no-op. */
  seedToken?: number;

  /**
   * When true, the input does NOT clear after `onSend`. Default false
   * (chat-style behavior — clear after send so user can type next message).
   *
   * Set true for one-shot commit flows like the onboarding describe step,
   * where the typed value needs to persist downstream (the rest of the
   * onboarding reads it from state on every step).
   */
  preserveOnSend?: boolean;

  // ── A turn in progress ────────────────────────────────────────────
  /**
   * Something is still answering (a chat turn runs). The box stays typeable,
   * so the owner can write the next message, but Send is off and
   * `busyReason` says why beside it. `disabled` is different: it turns the
   * whole input off.
   */
  busy?: boolean;
  /** Said beside Send while `busy` ("You can send this as soon as..."). */
  busyReason?: string;

  // ── Send held by the app ──────────────────────────────────────────
  /**
   * Send is off for a reason of the app's own (a plan pause, a budget used),
   * said beside it, while the box stays typeable: the words wait there for
   * when Send comes back. Wins over `busyReason`, since it outlasts the
   * turn. `disabled` is different: it turns the whole input off.
   */
  sendDisabledReason?: string | null;
  /**
   * The keyboard's hint, under the box on the right (2026-10-17): "Shift +
   * Enter for a new line" by default, in the page's language (KIT_COPY), null
   * for none. It stays while the box is typeable, beside any reason Send is
   * off, and is not a live region, so it is not read out again after every
   * send. Touch screens do not show it.
   */
  hint?: string | null;

  /** Bump this number to focus the text box with the caret at its end (words given back after a failed send). */
  focusToken?: number;

  // ── Accessibility and tests ───────────────────────────────────────
  /** The text box's accessible name. Defaults to the placeholder. */
  textareaAriaLabel?: string;
  /** data-testid of the text box (default `chat-input`). */
  inputTestId?: string;
  /** data-testid of the Send button (default `chat-send`). */
  sendTestId?: string;
}

/** The hint under every chat box, in English (the page's language reads KIT_COPY.chatInput.newlineHint). */
export const CHAT_NEWLINE_HINT = KIT_COPY_EN.chatInput.newlineHint;

/**
 * What a key press in the box does: Enter sends, Shift+Enter is a new line,
 * and nothing is sent while an input method is still composing a word (a
 * Japanese or Chinese IME confirms its word with Enter; keyCode 229 is that
 * same state in browsers that do not set isComposing).
 */
export function chatComposerKey(e: {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): 'send' | null {
  if (e.key !== 'Enter' || e.shiftKey) return null;
  if (e.isComposing || e.keyCode === 229) return null;
  return 'send';
}

/* ── Template parsing ─────────────────────────────────────────────── */

type TemplatePart =
  | { type: 'text'; value: string }
  | { type: 'slot'; placeholder: string; slotIdx: number };

const SLOT_RE = /\[([^\]]+)\]/g;

function parseTemplate(text: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let slotIdx = 0;
  SLOT_RE.lastIndex = 0;
  while ((m = SLOT_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
    parts.push({ type: 'slot', placeholder: m[1], slotIdx: slotIdx++ });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

function hasBrackets(text: string): boolean {
  return /\[[^\]]+\]/.test(text);
}

/* ── Component ────────────────────────────────────────────────────── */

export const ChatInput: React.FC<ChatInputProps> = ({
  placeholder = KIT_COPY.chatInput.placeholder,
  onSend,
  onAttach,
  maxHeight = 120,
  disabled = false,
  value,
  onChange,
  seedText,
  seedToken,
  preserveOnSend = false,
  busy = false,
  busyReason,
  sendDisabledReason,
  hint = KIT_COPY.chatInput.newlineHint,
  focusToken,
  textareaAriaLabel,
  inputTestId = 'chat-input',
  sendTestId = 'chat-send',
}) => {
  const isControlled = value !== undefined;
  const [internalText, setInternalText] = useState('');
  const text = isControlled ? value! : internalText;

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Template mode state ─────────────────────────────────────────
  const [templateText, setTemplateText] = useState<string | null>(null);
  const inTemplateMode = templateText !== null;
  const templateParts = useMemo(
    () => (templateText ? parseTemplate(templateText) : []),
    [templateText],
  );
  const slotCount = useMemo(
    () => templateParts.filter((p) => p.type === 'slot').length,
    [templateParts],
  );
  const [slotValues, setSlotValues] = useState<string[]>([]);
  const slotRefs = useRef<Array<HTMLSpanElement | null>>([]);

  const setText = useCallback(
    (next: string) => {
      if (!isControlled) setInternalText(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight]);

  useEffect(() => {
    if (!inTemplateMode) autoGrow();
  }, [text, inTemplateMode, autoGrow]);

  // ── Seed effect ─────────────────────────────────────────────────
  useEffect(() => {
    if (seedToken === undefined) return;
    const next = seedText ?? '';
    if (hasBrackets(next)) {
      // Template mode — initialize empty slot values, focus first slot
      setTemplateText(next);
      const count = (next.match(SLOT_RE) || []).length;
      setSlotValues(new Array(count).fill(''));
      requestAnimationFrame(() => slotRefs.current[0]?.focus());
    } else {
      // Plain seed — fill textarea
      setTemplateText(null);
      setText(next);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(next.length, next.length);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedToken]);

  // ── Focus request: the box, the caret after the last character ───
  useEffect(() => {
    if (focusToken === undefined || focusToken === 0) return;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange?.(end, end);
    });
  }, [focusToken]);

  // ── Send: assemble in template mode, plain in free-text mode ────
  const allSlotsFilled = useMemo(
    () => slotValues.length === slotCount && slotValues.every((v) => v.trim().length > 0),
    [slotValues, slotCount],
  );

  const assembleTemplate = useCallback(() => {
    return templateParts
      .map((p) => (p.type === 'text' ? p.value : (slotValues[p.slotIdx] ?? '').trim()))
      .join('');
  }, [templateParts, slotValues]);

  const exitTemplate = useCallback(() => {
    setTemplateText(null);
    setSlotValues([]);
  }, []);

  const held = !!sendDisabledReason;

  const handleSend = useCallback(() => {
    if (disabled || busy || held) return;
    if (inTemplateMode) {
      if (!allSlotsFilled) return;
      const assembled = assembleTemplate().trim();
      if (!assembled) return;
      onSend?.(assembled);
      exitTemplate();
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend?.(trimmed);
    if (!preserveOnSend) {
      setText('');
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.overflowY = 'hidden';
      }
    }
  }, [
    disabled,
    busy,
    held,
    inTemplateMode,
    allSlotsFilled,
    assembleTemplate,
    preserveOnSend,
    onSend,
    exitTemplate,
    text,
    setText,
  ]);

  /* ── Free-text mode handlers ─────────────────────────────────── */

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
    },
    [setText],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const k = chatComposerKey({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent?.isComposing,
        keyCode: e.keyCode,
      });
      if (k === 'send') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  /* ── Template mode handlers ──────────────────────────────────── */

  const updateSlot = useCallback((idx: number, val: string) => {
    setSlotValues((prev) => {
      const next = prev.slice();
      next[idx] = val;
      return next;
    });
  }, []);

  const focusSlot = useCallback((idx: number) => {
    const el = slotRefs.current[idx];
    if (!el) return;
    el.focus();
    // Place caret at the end of the slot's text content (Selection API,
    // because contenteditable spans don't have setSelectionRange).
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false); // false = collapse to end
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  const handleSlotKeyDown = useCallback(
    (e: KeyboardEvent<HTMLSpanElement>, idx: number) => {
      if (e.key === 'Enter') {
        // A word still being composed by an input method is not a send.
        if (e.nativeEvent?.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        if (idx < slotCount - 1) focusSlot(idx + 1);
        else handleSend();
      } else if (e.key === 'Tab' && !e.shiftKey && idx < slotCount - 1) {
        e.preventDefault();
        focusSlot(idx + 1);
      } else if (e.key === 'Tab' && e.shiftKey && idx > 0) {
        e.preventDefault();
        focusSlot(idx - 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        exitTemplate();
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    },
    [slotCount, focusSlot, handleSend, exitTemplate],
  );

  const sendDisabled =
    disabled || busy || held || (inTemplateMode ? !allSlotsFilled : !text.trim());
  const reasonId = React.useId();
  const hintId = React.useId();
  // Why Send is off, said under the box: the app's hold first (it outlasts
  // the turn), then the turn running.
  const reason: string | null = disabled ? null : held ? (sendDisabledReason as string) : busy && busyReason ? busyReason : null;
  // The keyboard's hint, while the box takes a new line (not in a template's slots).
  const shownHint = !disabled && !inTemplateMode && hint ? hint : null;
  const describedBy = [reason ? reasonId : '', shownHint ? hintId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className={s.field}>
      <div
        className={s.container}
        onClick={(e) => {
          // Don't steal focus from buttons or contenteditable slots that the
          // user clicked directly.
          const t = e.target as HTMLElement;
          if (t.closest('button, [contenteditable]')) return;
          if (inTemplateMode) {
            // Focus the first empty slot, or the last if all filled.
            const firstEmpty = slotValues.findIndex((v) => !v.trim());
            focusSlot(firstEmpty === -1 ? slotCount - 1 : firstEmpty);
          } else {
            textareaRef.current?.focus();
          }
        }}
      >
        {inTemplateMode ? (
          <div className={s.template}>
            {templateParts.map((p, i) =>
              p.type === 'text' ? (
                <span key={i} className={s.templateText}>
                  {p.value}
                </span>
              ) : (
                <SlotInput
                  key={i}
                  ref={(el) => {
                    slotRefs.current[p.slotIdx] = el;
                  }}
                  placeholder={p.placeholder}
                  value={slotValues[p.slotIdx] || ''}
                  onChange={(val) => updateSlot(p.slotIdx, val)}
                  onKeyDown={(e) => handleSlotKeyDown(e, p.slotIdx)}
                  disabled={disabled}
                />
              ),
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className={s.textarea}
            placeholder={placeholder}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            style={{ maxHeight }}
            aria-label={textareaAriaLabel ?? placeholder}
            aria-describedby={describedBy}
            enterKeyHint="send"
            data-testid={inputTestId}
          />
        )}

        <div className={s.row}>
          {inTemplateMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={exitTemplate}
              disabled={disabled}
              aria-label={KIT_COPY.chatInput.cancelTemplate}
              title={KIT_COPY.chatInput.cancelTitle}
            >
              {KIT_COPY.chatInput.cancel}
            </Button>
          )}
          <div className={s.actions}>
            {onAttach && !inTemplateMode && (
              <button
                type="button"
                className={s.attachBtn}
                onClick={onAttach}
                disabled={disabled}
                aria-label={KIT_COPY.chatInput.attachFile}
              >
                <PaperclipIcon size={15} />
              </button>
            )}
            {/* The kit's primary button (2026-10-16), square and icon only: the
                near-black fill with the turning ring, flat and ringless while
                disabled, still under reduced motion. Its look is Button's own;
                ChatInput only makes it square. */}
            <Button
              type="button"
              variant="primary"
              className={s.sendBtn}
              onClick={handleSend}
              disabled={sendDisabled}
              aria-label={KIT_COPY.chatInput.send}
              aria-describedby={reason ? reasonId : undefined}
              data-testid={sendTestId}
            >
              <NavIcon name="arrow-up" size={18} strokeWidth={2.25} />
            </Button>
          </div>
        </div>
      </div>
      {/* Under the box: why Send is off on the left, said and not left to
          guess; the keyboard's hint on the right, no live region, or it would
          be read out after every send. */}
      {(reason || shownHint) && (
        <div className={s.under}>
          {reason && (
            <span id={reasonId} className={s.reason} role="status">
              {reason}
            </span>
          )}
          {shownHint && (
            <span id={hintId} className={s.hint}>
              {shownHint}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/* ── SlotInput: contenteditable span for a template slot ─────────── */

interface SlotInputProps {
  placeholder: string;
  value: string;
  onChange: (val: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => void;
  disabled?: boolean;
}

const SlotInput = React.forwardRef<HTMLSpanElement, SlotInputProps>(
  ({ placeholder, value, onChange, onKeyDown, disabled }, ref) => {
    const innerRef = useRef<HTMLSpanElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLSpanElement, []);

    // Sync external `value` into the span only when it differs from the
    // current textContent. Avoids fighting the browser's caret while the
    // user is typing (each keystroke goes through onInput → setState →
    // re-render, but el.textContent already matches so we skip the rewrite).
    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      if (el.textContent !== value) {
        el.textContent = value;
      }
    }, [value]);

    const handleInput = (e: FormEvent<HTMLSpanElement>) => {
      onChange(e.currentTarget.textContent || '');
    };

    // Strip any rich content on paste so the slot stays plaintext even in
    // browsers that don't honor `contenteditable="plaintext-only"` (Firefox).
    const handlePaste = (e: ClipboardEvent<HTMLSpanElement>) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      // execCommand is deprecated but still the most reliable cross-browser
      // way to insert plain text into a contenteditable at the current caret.
      document.execCommand('insertText', false, text);
    };

    return (
      <span
        ref={innerRef}
        className={s.slotInput}
        contentEditable={disabled ? false : 'plaintext-only'}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        spellCheck={false}
        onInput={handleInput}
        onPaste={handlePaste}
        onKeyDown={onKeyDown}
      />
    );
  },
);
SlotInput.displayName = 'SlotInput';
