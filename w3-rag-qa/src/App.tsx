import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ToolCall } from './components/ToolCall';

export default function App() {
  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [input, setInput] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    sendMessage({ text });
    setInput('');
  }

  const busy = status === 'streaming' || status === 'submitted';

  return (
    <div className="app">
      <header className="header">
        <h1>RAG 问答站</h1>
        <p className="subtitle">W3 · 向量检索 + 流式生成（带引用来源可视化）</p>
      </header>

      <main className="messages">
        {messages.length === 0 && (
          <div className="empty">
            试着问：<br />
            「什么是 Agent？」「前端转 Agent 有什么优势？」「总结一下核心概念」
            <br />
            <span style={{ opacity: 0.7 }}>
              （助手会先调用 retrieve 工具检索 server/docs 里的文档，再带引用作答）
            </span>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <div className="role">{m.role === 'user' ? '你' : '助手'}</div>
            <div className="parts">
              {m.parts.map((part, i) => {
                if (part.type === 'text') {
                  return (
                    <p key={i} className="text">
                      {part.text}
                    </p>
                  );
                }
                if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
                  return <ToolCall key={i} part={part as any} />;
                }
                return null;
              })}
            </div>
          </div>
        ))}

        {busy && <div className="typing">助手正在检索并思考…</div>}
        {error && <div className="error">出错了：{error.message}</div>}
      </main>

      <form className="composer" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="基于知识库提问，回车发送…"
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          发送
        </button>
      </form>
    </div>
  );
}
