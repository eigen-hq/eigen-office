import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey, $getRoot, HISTORY_MERGE_TAG, type NodeKey } from 'lexical';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api-client';
import { readDocumentInk } from '@/lib/api/writer';
import { isInkFence, parseInk, setTranscript, strokesMark } from '../lib/ink';
import { INK_READ_TAG, inkPicture, readers } from '../lib/ink-read';
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
    let gone = false;
    /** No AI for the workspace: nothing more is asked this time. */
    let off = false;

    const read = async (key: NodeKey): Promise<string | null> => {
      window.clearTimeout(timers.get(key));
      timers.delete(key);
      if (gone || off) return null;
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
      let said = '';
      if (mark) {
        const picture = await inkPicture(ink);
        if (!picture || gone) return null;
        try {
          said = (await readDocumentInk(documentId, picture)).text;
        } catch (error) {
          if (error instanceof ApiError && error.code === 'ai_not_configured') off = true;
          return null;
        }
      }
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
      return said.trim();
    };
    readers.set(editor, read);

    const unlisten = editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has('page-load') || tags.has(INK_READ_TAG) || !editor.isEditable()) return;
      editorState.read(() => {
        for (const node of $getRoot().getChildren()) {
          if (!$isRawBlockNode(node)) continue;
          const key = node.getKey();
          const text = node.getText();
          if (seen.get(key) === text) continue;
          const first = !seen.has(key);
          seen.set(key, text);
          // What stood when the page was opened is not read – only what is drawn now.
          if (first) continue;
          if (!isInkFence(text.split('\n'))) continue;
          window.clearTimeout(timers.get(key));
          timers.set(
            key,
            window.setTimeout(() => void read(key), REST_MS),
          );
        }
      });
    });
    // What stands now is what was opened: seen, not read.
    editor.getEditorState().read(() => {
      for (const node of $getRoot().getChildren()) {
        if ($isRawBlockNode(node)) seen.set(node.getKey(), node.getText());
      }
    });

    return () => {
      gone = true;
      if (readers.get(editor) === read) readers.delete(editor);
      unlisten();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [editor, documentId]);

  return null;
}
