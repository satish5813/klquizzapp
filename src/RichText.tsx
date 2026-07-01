// Renders MCQ text with code support:
//  - literal "\n" / "\t" escape sequences become real newlines/tabs
//  - ```fenced blocks``` OR any code-looking text  → monospace code block
//  - `inline code` → inline monospace; prose keeps its line breaks
import { ReactNode } from 'react';

// turn literal backslash-n / -t / -r (as stored in some generated questions) into real chars
const unescape = (s: string) =>
  String(s ?? '').replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\n');

// heuristics: real newline, code punctuation, or clear code constructs (but NOT prose like "class definition")
const looksLikeCode = (s: string) =>
  /\n/.test(s) ||
  /[{};]/.test(s) ||
  /\b(def|class|void|public|private|static|function)\s+\w+\s*\(/.test(s) ||
  /(self\.|System\.|console\.|println|printf|=>|->|::|==|!=|\w+\s*=\s*\w)/.test(s);

function CodeBlock({ value }: { value: string }) {
  return (
    <pre className="my-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-900 px-3 py-2 font-mono text-[14px] leading-relaxed text-slate-100">
      <code>{value}</code>
    </pre>
  );
}

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
  const src = unescape(text);
  const out: ReactNode[] = [];
  const re = /```[\w+-]*\n?([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(renderText(src.slice(last, m.index), k++));
    out.push(<CodeBlock key={k++} value={m[1].replace(/\n$/, '')} />);
    last = re.lastIndex;
  }
  if (last < src.length) out.push(renderText(src.slice(last), k++));
  return <div className={className}>{out}</div>;
}

function renderText(seg: string, key: number): ReactNode {
  return looksLikeCode(seg) ? <CodeBlock key={key} value={seg.trim()} /> : <Inline key={key} value={seg} />;
}
