import { create } from "zustand";

/**
 * Small pictures shown in the reader's own line, for this visit only.
 *
 * A photo is deleted once its portrait is drawn, so the conversation keeps no
 * copy of it: the line carries the pictures the reader chose while the page is
 * open, and reads as plain text after a reload.
 */
export const useMessageThumbs = create<{ byMessage: Record<string, string[]> }>(() => ({ byMessage: {} }));

export function rememberThumbs(messageId: string, urls: string[]): void {
  if (urls.length === 0) return;
  useMessageThumbs.setState((state) => ({ byMessage: { ...state.byMessage, [messageId]: urls } }));
}

/** The conversation closed: its object URLs are released and its lines read as plain text. */
export function forgetThumbs(): void {
  const { byMessage } = useMessageThumbs.getState();
  const all = Object.values(byMessage).flat();
  if (all.length === 0) return;
  for (const url of all) URL.revokeObjectURL(url);
  useMessageThumbs.setState({ byMessage: {} });
}
