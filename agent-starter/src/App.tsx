import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

export default function App() {
  // 关键（v7）：用 transport 而非 api 字段，DefaultChatTransport 从 'ai' 导入
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || status === 'streaming') return;
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="app">
      <h1>Agent Starter</h1>
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="role">{m.role === 'user' ? '你' : '助手'}</div>
            {m.parts.map((part, i) => {
              if (part.type === 'text') {
                return (
                  <p key={i} className="text">
                    {part.text}
                  </p>
                );
              }
              // 关键（v7）：前端未声明工具 schema 时类型为 'dynamic-tool'
              if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
                const p = part as any;
                return (
                  <div key={i} className="tool">
                    🔧 <b>{p.toolName}</b> · {p.state ?? 'done'}
                    <pre>{JSON.stringify(p.input ?? {}, null, 2)}</pre>
                    {p.output ? <pre>{JSON.stringify(p.output, null, 2)}</pre> : null}
                  </div>
                );
              }
              return null;
            })}
          </div>
        ))}
        {status === 'submitted' && <div className="hint">思考中…</div>}
        {error && <div className="error">出错：{error.message}</div>}
      </div>
      <form onSubmit={submit} className="input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问问时间，或算个算式…"
        />
        <button type="submit">发送</button>
      </form>
    </div>
  );
}
