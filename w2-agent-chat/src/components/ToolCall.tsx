// 工具调用可视化组件：展示工具名、输入、输出（运行中显示占位）
export function ToolCall({ part }: { part: any }) {
  const running = part.output === undefined;
  return (
    <div className={`tool-call ${running ? 'running' : 'done'}`}>
      <div className="tool-head">
        <span className="tool-icon">🔧</span>
        <span className="tool-name">{part.toolName}</span>
        <span className="tool-state">{running ? '运行中…' : '完成'}</span>
      </div>
      <div className="tool-io">
        <div>
          <span className="label">输入</span>
          <code>{JSON.stringify(part.input)}</code>
        </div>
        <div>
          <span className="label">输出</span>
          <code>{running ? '…' : JSON.stringify(part.output)}</code>
        </div>
      </div>
    </div>
  );
}
