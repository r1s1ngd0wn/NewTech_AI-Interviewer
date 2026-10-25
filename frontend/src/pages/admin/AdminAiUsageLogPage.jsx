import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function AdminAiUsageLogPage() {
  const [document, setDocument] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setDocument(await api.getAdminAiUsageLog());
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return (
    <section aria-labelledby="ai-usage-log-title">
      <div className="admin-usage-toolbar">
        <div>
          <h2 id="ai-usage-log-title">AI Usage · Development log</h2>
          <p className="muted">Read-only view of the project’s AI-assisted development record.</p>
          {document && <p className="muted admin-usage-updated">Source file updated {new Date(document.updatedAt).toLocaleString()} · refreshes every 30 seconds.</p>}
        </div>
        <button className="btn btn-secondary btn-sm" type="button" onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && !document && <div className="form-error admin-usage-error" role="alert">{error}</div>}
      {error && document && <p className="admin-note" role="status">Could not refresh the file. Showing the last loaded copy. {error}</p>}
      {!document && !error && <p className="admin-loading" role="status">Loading AI usage log…</p>}
      {document && <MarkdownDocument content={document.content} />}
    </section>
  );
}

function MarkdownDocument({ content }) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2], key: index });
      index++;
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push({ type: 'rule', key: index++ });
      continue;
    }

    if (isTableLine(line) && isTableLine(lines[index + 1] || '')) {
      const table = [];
      while (index < lines.length && isTableLine(lines[index])) table.push(splitTableRow(lines[index++]));
      blocks.push({ type: 'table', rows: table, key: index });
      continue;
    }

    const listMatch = /^\s*((?:[-*])|(?:\d+\.))\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+/.test(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const item = /^\s*((?:[-*])|(?:\d+\.))\s+(.+)$/.exec(lines[index]);
        if (!item || /\d+/.test(item[1]) !== ordered) break;
        items.push(item[2]);
        index++;
      }
      blocks.push({ type: ordered ? 'ordered-list' : 'list', items, key: index });
      continue;
    }

    if (line.startsWith('>')) {
      const quote = [];
      while (index < lines.length && lines[index].startsWith('>')) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push({ type: 'quote', text: quote.join(' '), key: index });
      continue;
    }

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) paragraph.push(lines[index++].trim());
    blocks.push({ type: 'paragraph', text: paragraph.join(' '), key: index });
  }

  return <article className="admin-usage-content">{blocks.map(block => <MarkdownBlock key={block.key} block={block} />)}</article>;
}

function isTableLine(line) { return /^\s*\|.*\|\s*$/.test(line); }
function splitTableRow(line) { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim()); }
function startsBlock(line) {
  return /^(#{1,6}\s|\s*(?:---+|\*\*\*+)\s*$|\s*[>*]\s?|\s*(?:[-*]|\d+\.)\s+)/.test(line) || isTableLine(line);
}

function MarkdownBlock({ block }) {
  if (block.type === 'heading') {
    const Tag = `h${Math.min(block.level, 4)}`;
    return <Tag><InlineMarkdown text={block.text} /></Tag>;
  }
  if (block.type === 'rule') return <hr />;
  if (block.type === 'paragraph') return <p><InlineMarkdown text={block.text} /></p>;
  if (block.type === 'quote') return <blockquote><InlineMarkdown text={block.text} /></blockquote>;
  if (block.type === 'list' || block.type === 'ordered-list') {
    const Tag = block.type === 'list' ? 'ul' : 'ol';
    return <Tag>{block.items.map((item, index) => <li key={index}><InlineMarkdown text={item} /></li>)}</Tag>;
  }
  if (block.type === 'table') {
    const rows = block.rows.filter((row, index) => !(index === 1 && row.every(cell => /^:?-{3,}:?$/.test(cell))));
    const [header, ...body] = rows;
    return <div className="admin-usage-table-wrap"><table className="admin-usage-table">
      {header && <thead><tr>{header.map((cell, index) => <th scope="col" key={index}><InlineMarkdown text={cell} /></th>)}</tr></thead>}
      <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><InlineMarkdown text={cell} /></td>)}</tr>)}</tbody>
    </table></div>;
  }
  return null;
}

function InlineMarkdown({ text }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|<br\s*\/?>)/gi);
  return parts.map((part, index) => {
    if (/^`[^`]+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^<br\s*\/?>$/i.test(part)) return <br key={index} />;
    return part;
  });
}
