// Renders MCQ text with code support:
//  - ```fenced blocks``` → a monospace code block (larger font, preserves whitespace)
//  - `inline code` → inline monospace
//  - plain text keeps its line breaks
import { ReactNode } from 'react';

function Inline({ value }: { value: string }) {
  const segs = value.split(/(`[^`]+`)/g);
  return (
    <span className="whitespace-pre-wrap break-words">
      {segs.map((s, i) =>
        s.length > 1 && s.startsWith('`') && s.endsWith('`')
          ? <code key={i} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.95em] text-pink-700">{s.slice(1, -1)}</code>
          : <span key={i}>{s}</span>,
      )}
    </span>
  );
}

export default function RichText({ text, className = '' }: { text: string; className?: string }) {
  const src = String(text ?? '');
  const out: ReactNode[] = [];
  const re = /```[\w+-]*\n?([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(<Inline key={k++} value={src.slice(last, m.index)} />);
    out.push(
      <pre key={k++} className="my-2 overflow-x-auto rounded-lg bg-slate-900 px-4 py-3 font-mono text-[15px] leading-relaxed text-slate-100">
        <code>{m[1].replace(/\n$/, '')}</code>
      </pre>,
    );
    last = re.lastIndex;
  }
  if (last < src.length) out.push(<Inline key={k++} value={src.slice(last)} />);
  return <div className={className}>{out}</div>;
}
