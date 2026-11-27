import type Anthropic from '@anthropic-ai/sdk';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import { runTurn } from './ai-providers';
import { loadDocument } from './documents';
import { imageMediaType } from './edits/images';
import { workspaceAiConnection } from './integration-keys';

/*
 * What a page's handwriting says (as Apple's Notes reads it): the drawing comes as a picture of its
 * strokes, its words come back as text – kept in the drawing (`text` line, `lib/ink.ts`) for the
 * search and the page's AI, copied or turned into text by hand. Nothing is kept here.
 */

/** A drawing's picture is a few hundred kilobytes; more is no drawing. */
export const MAX_INK_PICTURE_BYTES = 4 * 1024 * 1024;
/** The most text one drawing gives back. */
const MAX_INK_TEXT = 4000;
const NOTHING = '-';

const SYSTEM = `You read handwriting. The picture is a drawing from a note page: handwritten words, maybe sketches, arrows, boxes, underlines.

Write out the handwritten words exactly as written, in their own language and spelling – no translation, no correction, no comment. Keep the lines as they are (one line of writing, one line of text). A list stays a list ("- " before each item where the writing has a bullet or dash). Shapes and sketches without words are left out; words inside or beside them are written out.

Answer with the text only. If there are no words to read, answer with a single "${NOTHING}".`;

export async function readInk(
  deps: AppDeps,
  userId: string,
  documentId: string,
  bytes: Uint8Array,
): Promise<{ text: string }> {
  const type = imageMediaType(bytes);
  if (type !== 'image/png') throw badRequest('Das ist kein Bild einer Zeichnung.');
  const { node } = await loadDocument(deps, userId, documentId, 'edit');
  const found = await workspaceAiConnection(deps, node.workspaceId);
  if (!found.connection) throw new ApiError(409, 'ai_not_configured', found.error);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  timer.unref?.();
  try {
    const picture: Anthropic.Beta.BetaContentBlockParam = {
      type: 'image',
      source: { type: 'base64', media_type: type, data: Buffer.from(bytes).toString('base64') },
    };
    const result = await runTurn(deps, found.connection, {
      system: SYSTEM,
      tools: [],
      messages: [{ role: 'user', content: [picture, { type: 'text', text: 'What does it say?' }] }],
      taskBudgetTokens: 20_000,
      effort: 'low',
      feature: 'handwriting',
      signal: controller.signal,
    });
    const said = result.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    if (result.stop === 'refusal' || said === NOTHING) return { text: '' };
    return { text: said.slice(0, MAX_INK_TEXT) };
  } finally {
    clearTimeout(timer);
  }
}
