import { createContext, use, useEffect } from 'react';

/*
 * The companion's heading names what the computer has open. The computer's tab title says it
 * badly for some pages („Post“, „(3) Sender“): what the phone loaded for it (the mail's subject,
 * the conversation's name …) is said instead.
 */

const TitleContext = createContext<((title: string | null) => void) | null>(null);

export const CompanionTitle = TitleContext.Provider;

/** Names the open thing in the companion's heading while shown. */
export function useCompanionTitle(title: string | null | undefined) {
  const set = use(TitleContext);
  useEffect(() => {
    if (!set || !title) return;
    set(title);
    return () => set(null);
  }, [set, title]);
}
