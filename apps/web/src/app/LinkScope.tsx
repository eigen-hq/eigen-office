import type { ReactNode } from 'react';
import { useActiveWorkspace } from '@/features/workspaces';
import { LinkPreviewScope } from '@/lib/links';

/** Every page asks for web addresses' cards in the workspace it works in (`lib/links`). */
export function LinkScope({ children }: { children: ReactNode }) {
  const workspace = useActiveWorkspace();
  return <LinkPreviewScope value={workspace?.id ?? null}>{children}</LinkPreviewScope>;
}
