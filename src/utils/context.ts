import type { Editor, EditorPosition } from 'obsidian';

export function isInsideCodeBlock(editor: Editor, cursor: EditorPosition): boolean {
  let fenceCount = 0;
  for (let i = 0; i < cursor.line; i++) {
    const line = editor.getLine(i);
    if (line.trimStart().startsWith('```')) {
      fenceCount++;
    }
  }
  return fenceCount % 2 === 1;
}

export function isInsideInlineCode(editor: Editor, cursor: EditorPosition): boolean {
  const line = editor.getLine(cursor.line);
  const before = line.substring(0, cursor.ch);
  const backticks = (before.match(/`/g) || []).length;
  return backticks % 2 === 1;
}

export function isInsideIgnoredContext(editor: Editor): boolean {
  const cursor = editor.getCursor();
  return isInsideCodeBlock(editor, cursor) || isInsideInlineCode(editor, cursor);
}
