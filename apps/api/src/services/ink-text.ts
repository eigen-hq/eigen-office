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

/** A drawing's pictures (a band each) are a few hundred kilobytes; more is no drawing. */
export const MAX_INK_PICTURE_BYTES = 16 * 1024 * 1024;
/** A tall drawing comes in bands, top to bottom: this many at most. */
export const MAX_INK_BANDS = 8;
/** The most text one drawing gives back. */
const MAX_INK_TEXT = 4000;
const NOTHING = '-';

const SYSTEM = `You read handwriting. The picture is a drawing from a note page (a tall one comes as several pictures, top to bottom, one band each, maybe overlapping a little – read them as one page, a line cut in two once): handwritten words, maybe sketches, arrows, boxes, underlines.

Write out the handwritten words exactly as written, in their own language and spelling – no translation, no correction, no comment. Keep the lines as they are (one line of writing, one line of text). A list stays a list ("- " before each item where the writing has a bullet or dash). Shapes and sketches without words are left out; words inside or beside them are written out.

Answer with the text only. If there are no words to read, answer with a single "${NOTHING}".`;

export async function readInk(
  deps: AppDeps,
  userId: string,
  documentId: string,
  bands: readonly Uint8Array[],
): Promise<{ text: string }> {
  if (bands.length === 0 || bands.length > MAX_INK_BANDS)
    throw badRequest('Das ist kein Bild einer Zeichnung.');
  for (const band of bands) {
    if (imageMediaType(band) !== 'image/png')
      throw badRequest('Das ist kein Bild einer Zeichnung.');
  }
  const { node } = await loadDocument(deps, userId, documentId, 'edit');
  const found = await workspaceAiConnection(deps, node.workspaceId);
  if (!found.connection) throw new ApiError(409, 'ai_not_configured', found.error);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  timer.unref?.();
  try {
    const pictures: Anthropic.Beta.BetaContentBlockParam[] = bands.map((band) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: Buffer.from(band).toString('base64'),
      },
    }));
    const result = await runTurn(deps, found.connection, {
      system: SYSTEM,
      tools: [],
      messages: [
        { role: 'user', content: [...pictures, { type: 'text', text: 'What does it say?' }] },
      ],
      taskBudgetTokens: 20_000 + 4_000 * (bands.length - 1),
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
