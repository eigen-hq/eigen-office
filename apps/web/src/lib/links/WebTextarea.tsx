import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { AutosizeTextarea } from '@/ui/AutosizeTextarea';
import { cn } from '@/ui/cn';
import { WebText } from './WebText';

/** A web address written out somewhere in the text. */
const HAS_WRITTEN_URL = /https?:\/\/\S/i;

/**
 * A field of free words (a to-do's description, an event's notes) that shows its web addresses
 * as everywhere else (`WebText`: chip in a sentence, card alone on its line) while one is not
 * typing in it. A click beside a link (or Tab onto it) makes the same place the field again,
 * the caret at its end; a click on a link opens it, words dragged over stay selected to copy.
 * Without an address it is the field as ever.
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
  // A button held down while the field is left: the shown text (its cards taller than the words)
  // comes once it is let go, so what was pressed below stays where it was until its click.
  const pressed = useRef(false);
  useEffect(() => {
    if (!typing) return;
    const down = () => (pressed.current = true);
    const up = () => (pressed.current = false);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      pressed.current = false;
    };
  }, [typing]);
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
        // A link pressed keeps the focus where it is (Safari and Firefox would put it here), so
        // its click arrives.
        onMouseDown={(event) => {
          if ((event.target as Element).closest('a')) event.preventDefault();
        }}
        // Tab onto it types in it; a mouse goes by the click (a drag selects words to copy).
        onFocus={(event) => {
          if (!readOnly && event.target === event.currentTarget) {
            if (event.currentTarget.matches(':focus-visible')) setTyping(true);
          }
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
        onBlur?.(event);
        // Back in it meanwhile (the field is the one there now): it stays.
        const done = () => {
          if (!field.current || document.activeElement !== field.current) setTyping(false);
        };
        if (!pressed.current) return done();
        // After the press's click (it comes right after the button is let go, or never).
        const later = () => {
          document.removeEventListener('pointerup', later, true);
          document.removeEventListener('pointercancel', later, true);
          setTimeout(done);
        };
        document.addEventListener('pointerup', later, true);
        document.addEventListener('pointercancel', later, true);
      }}
      {...props}
    />
  );
}
