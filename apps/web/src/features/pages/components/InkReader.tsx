import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getNodeByKey,
  $getRoot,
  HISTORY_MERGE_TAG,
  type EditorState,
  type NodeKey,
} from 'lexical';
import { useEffect } from 'react';
import {
  isInkFence,
  parseInk,
  setTranscript,
  strokesMark,
  type Ink,
  type InkEntry,
} from '../lib/ink';
import { INK_READ_TAG, inkLines, inkRecognizer, readers } from '../lib/ink-read';
import { $isRawBlockNode } from '../lib/nodes';

/*
 * What the handwriting says, kept in its drawing (as Apple's Notes reads it): on a device that
 * reads handwriting itself (`lib/ink-read.ts` – the installed app, Chrome's own), a drawing is read
 * once the pen rests and its words go into the drawing's `text` line, which the search and the
 * page's AI read. Not an undo step of its own, nothing to see happen. Nothing is sent away for it;
 * where the device cannot read, nothing is read.
 */

/** How long the pen rests before its drawing is read. */
const REST_MS = 1000;

/** The mark of a drawing's strokes – what its `text` line must carry to be as read. */
const markOf = (ink: Ink) => (ink.strokes.length > 0 ? strokesMark(ink) : '');

export function InkReader() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const timers = new Map<NodeKey, number>();
    const seen = new Map<NodeKey, string>();
    /** A drawing being read: asked again, it waits for that first. */
    const busy = new Map<NodeKey, Promise<string | null>>();
    let gone = false;
    let unlisten = () => {};

    void inkRecognizer().then((recognize) => {
      if (!recognize || gone) return;

      /** What the strokes say, line by line. */
      const ask = async (strokes: readonly InkEntry[]): Promise<string | null> => {
        const lines = inkLines(strokes);
        if (lines.length === 0) return '';
        try {
          const said = await recognize(lines);
          return said
            .map((line) => line.trim())
            .filter(Boolean)
            .join('\n');
        } catch {
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
        const mark = markOf(ink);
        // Kept as one line (` / ` between its lines): its lines again.
        if ((ink.transcript?.mark ?? '') === mark)
          return (ink.transcript?.text ?? '').split(' / ').join('\n');
        const said = mark ? await ask(ink.strokes) : '';
        if (said === null || gone) return null;
        editor.update(
          () => {
            const node = $getNodeByKey(key);
            if (!$isRawBlockNode(node)) return;
            const now = node.getText();
            // Drawn in meanwhile: read again once it rests.
            if (markOf(parseInk(now)) !== mark) return;
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

      /** Drawings whose words are not (or no longer) as they read – changed where none read them. */
      const readStale = () =>
        editor.getEditorState().read(() => {
          for (const node of $getRoot().getChildren()) {
            if (!$isRawBlockNode(node) || !isInkFence(node.getText().split('\n'))) continue;
            const ink = parseInk(node.getText());
            if ((ink.transcript?.mark ?? '') !== markOf(ink)) later(node.getKey(), REST_MS);
          }
        });

      const offUpdates = editor.registerUpdateListener(({ editorState, tags }) => {
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
            if (first || !isInkFence(text.split('\n'))) continue;
            later(key, REST_MS);
          }
        });
      });
      // In Bearbeiten: what was drawn where no one could read it is read now.
      const offEditable = editor.registerEditableListener((editable) => {
        if (editable) readStale();
      });
      see(editor.getEditorState());
      if (editor.isEditable()) readStale();
      unlisten = () => {
        offUpdates();
        offEditable();
        if (readers.get(editor)?.drawing === read) readers.delete(editor);
      };
    });

    return () => {
      gone = true;
      unlisten();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [editor]);

  return null;
}
