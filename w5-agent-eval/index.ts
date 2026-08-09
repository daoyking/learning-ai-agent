import 'dotenv/config';
import { runDemo } from './src/demo.js';

// npm start → 离线演示 Tracer（无需 API key）
// npm run eval → 真实 LLM 评测（需 .env 中配置 key）
runDemo().catch((err) => {
  console.error(err);
  process.exit(1);
});
