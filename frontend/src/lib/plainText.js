// Chat replies are shown as plain text, but models often add markdown anyway (**bold**, "* " bullets,
// "# " headings). This turns those into plain text so the page never shows stray asterisks, and keeps
// the line breaks (the chat bubbles use white-space: pre-line).
export function plainText(text) {
  return String(text ?? "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[*\-][ \t]+/gm, "• ");
}
