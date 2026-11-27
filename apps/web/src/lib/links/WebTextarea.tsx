import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { AutosizeTextarea } from '@/ui/AutosizeTextarea';
import { cn } from '@/ui/cn';
import { WebText } from './WebText';

/** A web address written out somewhere in the text. */
const HAS_WRITTEN_URL = /https?:\/\/\S/i;

/**
 * A field of free words (a to-do's description, an event's notes) that shows its web addresses
 * as everywhere else (`WebText`: chip in a sentence, card alone on its line) while one is not
 * typing in it. A click beside a link (or Tab onto it) makes the same place the field again,
 * the caret at its end; a click on a link opens it. Without an address it is the field as ever.
 */
export function WebTextarea({
  value,
  readOnly,
  className,
  onFocus,
  onBlur,
  ...props
}: Omit<ComponentProps<typeof AutosizeTextarea>, 'ref'>) {
  const [typing, setTyping] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Switched to the field by a click or Tab: the caret goes in at once.
  useLayoutEffect(() => {
    const element = field.current;
    if (!typing || !element || document.activeElement === element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [typing]);

  if (!typing && HAS_WRITTEN_URL.test(value)) {
    return (
      <div
        role="textbox"
        aria-multiline
        aria-readonly={readOnly || undefined}
        aria-label={props['aria-label']}
        tabIndex={readOnly ? undefined : 0}
        className={cn(
          'block w-full break-words whitespace-pre-wrap',
          !readOnly && 'cursor-text',
          className,
        )}
        onFocus={(event) => {
          if (!readOnly && event.target === event.currentTarget) setTyping(true);
        }}
        onClick={(event) => {
          if (readOnly || (event.target as Element).closest('a')) return;
          // Words being selected to copy stay as they are shown.
          if (window.getSelection()?.toString()) return;
          setTyping(true);
        }}
      >
        <WebText text={value} />
      </div>
    );
  }
  return (
    <AutosizeTextarea
      ref={field}
      value={value}
      readOnly={readOnly}
      className={className}
      onFocus={(event) => {
        setTyping(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setTyping(false);
        onBlur?.(event);
      }}
      {...props}
    />
  );
}
