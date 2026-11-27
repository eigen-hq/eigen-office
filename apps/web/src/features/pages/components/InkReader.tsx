import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getNodeByKey,
  $getRoot,
  HISTORY_MERGE_TAG,
  type EditorState,
  type NodeKey,
} from 'lexical';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api-client';
import { readDocumentInk } from '@/lib/api/writer';
import { isInkFence, parseInk, setTranscript, strokesMark, type InkEntry } from '../lib/ink';
import { INK_READ_TAG, inkPictures, readers } from '../lib/ink-read';
import { $isRawBlockNode } from '../lib/nodes';

/*
 * What the handwriting says, kept in its drawing (as Apple's Notes reads it): a drawing drawn in
 * is read by the AI once the pen rests – its picture sent, its words written into the drawing's
 * `text` line, which the search and the page's AI read. Not an undo step of its own, nothing to
 * see happen; without an AI it stays unread. Only what is drawn here is read – opening a page
 * writes nothing.
 */

/** How long the pen rests before its drawing is read. */
const REST_MS = 2500;

export function InkReader({ documentId }: { documentId: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const timers = new Map<NodeKey, number>();
    const seen = new Map<NodeKey, string>();
    /** A drawing being read: asked again, it waits for that first. */
    const busy = new Map<NodeKey, Promise<string | null>>();
    /** Failed reads (offline, too many) of each drawing, tried again a little later. */
    const failed = new Map<NodeKey, number>();
    let gone = false;
    /** No AI for the workspace: nothing more is asked this time. */
    let off = false;

    /** What the strokes say, asked of the AI; `null`: not to be read now. */
    const ask = async (strokes: readonly InkEntry[]): Promise<string | null> => {
      if (gone || off) return null;
      const bands = await inkPictures(strokes);
      if (bands.length === 0 || gone) return bands.length === 0 ? '' : null;
      try {
        return (await readDocumentInk(documentId, bands)).text.trim();
      } catch (error) {
        if (error instanceof ApiError && error.code === 'ai_not_configured') off = true;
        return null;
      }
    };

    const later = (key: NodeKey, ms: number) => {
      window.clearTimeout(timers.get(key));
      timers.set(
        key,
        window.setTimeout(() => void read(key), ms),
      );
    };

    const readOnce = async (key: NodeKey): Promise<string | null> => {
      const text = editor.read(() => {
        const node = $getNodeByKey(key);
        return $isRawBlockNode(node) ? node.getText() : null;
      });
      if (text === null) return null;
      const ink = parseInk(text);
      const mark = ink.strokes.length > 0 ? strokesMark(ink) : '';
      // Kept as one line (` / ` between its lines): its lines again.
      if ((ink.transcript?.mark ?? '') === mark)
        return (ink.transcript?.text ?? '').split(' / ').join('\n');
      const said = mark ? await ask(ink.strokes) : '';
      if (said === null) {
        // Not read (offline, too many at once): once or twice more, a little later.
        const tries = (failed.get(key) ?? 0) + 1;
        failed.set(key, tries);
        if (!gone && !off && tries <= 2) later(key, 15_000 * tries);
        return null;
      }
      failed.delete(key);
      if (gone) return null;
      editor.update(
        () => {
          const node = $getNodeByKey(key);
          if (!$isRawBlockNode(node)) return;
          const now = node.getText();
          const ink = parseInk(now);
          // Drawn in meanwhile: read again once it rests.
          if ((ink.strokes.length > 0 ? strokesMark(ink) : '') !== mark) return;
          const written = setTranscript(now, mark, said);
          if (written !== now) node.setText(written);
        },
        { tag: [HISTORY_MERGE_TAG, INK_READ_TAG] },
      );
      return said;
    };

    const read = async (key: NodeKey): Promise<string | null> => {
      window.clearTimeout(timers.get(key));
      timers.delete(key);
      const before = busy.get(key);
      if (before) await before.catch(() => null);
      const run = readOnce(key);
      busy.set(key, run);
      try {
        return await run;
      } finally {
        if (busy.get(key) === run) busy.delete(key);
      }
    };
    readers.set(editor, { drawing: read, strokes: ask });

    /** What stands now is what was opened (or came in): seen, not read. */
    const see = (state: EditorState) =>
      state.read(() => {
        for (const node of $getRoot().getChildren()) {
          if ($isRawBlockNode(node)) seen.set(node.getKey(), node.getText());
        }
      });

    const unlisten = editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has('page-load')) {
        see(editorState);
        return;
      }
      if (tags.has(INK_READ_TAG) || !editor.isEditable()) return;
      editorState.read(() => {
        for (const node of $getRoot().getChildren()) {
          if (!$isRawBlockNode(node)) continue;
          const key = node.getKey();
          const text = node.getText();
          if (seen.get(key) === text) continue;
          const first = !seen.has(key);
          seen.set(key, text);
          // A block just made (a drawing put down) has nothing to read yet.
          if (first) continue;
          if (!isInkFence(text.split('\n'))) continue;
          failed.delete(key);
          later(key, REST_MS);
        }
      });
    });
    see(editor.getEditorState());

    return () => {
      gone = true;
      if (readers.get(editor)?.drawing === read) readers.delete(editor);
      unlisten();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [editor, documentId]);

  return null;
}
