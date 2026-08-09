// 工具调用可视化组件：展示工具名、输入、输出（运行中显示占位）
export function ToolCall({ part }: { part: any }) {
  const running = part.output === undefined;
  // retrieve 工具：把来源清单渲染成更友好的列表
  const isRetrieve = part.toolName === 'retrieve' && !running && part.output?.results;
  return (
    <div className={`tool-call ${running ? 'running' : 'done'}`}>
      <div className="tool-head">
        <span className="tool-icon">🔧</span>
        <span className="tool-name">{part.toolName}</span>
        <span className="tool-state">{running ? '检索中…' : '完成'}</span>
      </div>
      <div className="tool-io">
        <div>
          <span className="label">输入</span>
          <code>{JSON.stringify(part.input)}</code>
        </div>
        {isRetrieve ? (
          <div>
            <span className="label">检索到 {part.output.results.length} 条来源</span>
            <ul className="sources">
              {part.output.results.map((r: any, idx: number) => (
                <li key={idx}>
                  <b>{r.source}</b> <span className="score">相似度 {r.score}</span>
                  <br />
                  <span className="snippet">{r.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div>
            <span className="label">输出</span>
            <code>{running ? '…' : JSON.stringify(part.output)}</code>
          </div>
        )}
      </div>
    </div>
  );
}
