import 'dotenv/config';
import { resumeScorer } from './agents/resumeScorer.js';

async function main() {
  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'missing') {
    console.warn('⚠️  未配置 OPENAI_API_KEY，请在 .env 中填写后再运行\n');
  }

  const prompt =
    '请读取我的简历与目标岗位 JD，按 5 个维度打分（每项 0-10），给出总分与最优先的 3 条改进建议。用中文 Markdown 输出。';

  console.log('🤖 正在调用 resume-scorer（多步：读简历 → 抓 JD → 打分）...\n');

  const result = await resumeScorer.generate(prompt);

  console.log(result.text);
}

main().catch((err) => {
  console.error('运行出错：', err);
  process.exit(1);
});
