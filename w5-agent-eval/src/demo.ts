import { tracer } from './trace.js';
import { langfuseExporter } from './langfuse.js';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 离线演示：不调用任何 LLM，纯展示自建 Tracer 如何记录一次「伪 Agent」运行。
export async function runDemo(): Promise<void> {
  console.log('🔭 离线演示：自建 Tracer 如何记录一次「伪 Agent」运行\n');
  await tracer.span('agent:run', async () => {
    await tracer.span('retrieve', async () => {
      tracer.event('hit', { doc: 'rag' });
      await sleep(20);
    });
    await tracer.span('tool:calculator', async () => {
      tracer.event('result', { value: 84 });
      await sleep(10);
    });
    await tracer.span('model:generate', async () => {
      tracer.event('tokens', { prompt: 120, completion: 45 });
      await sleep(30);
    });
  });
  console.log(tracer.report());
  await langfuseExporter.flush();
  console.log('\n💡 接真实 Agent 时，把每个阶段包进 tracer.span() 即可获得同样的时间线；');
  console.log('   生产环境可把 span 结构对接 OpenTelemetry，由 OTLP 导出到 Langfuse / Jaeger。');
}

if (process.argv[1]?.endsWith('demo.ts')) {
  runDemo().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
