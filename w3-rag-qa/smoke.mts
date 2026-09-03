import {answerWithRag} from './server/rag-baseline.ts';
const r = await answerWithRag('RAG 的完整流程包含哪三个阶段？', 3);
console.log('SOURCES:', r.sources);
console.log('ANSWER:', r.answer.slice(0, 500));
