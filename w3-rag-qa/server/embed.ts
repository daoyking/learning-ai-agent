import { createOpenAI } from '@ai-sdk/openai';

// 向量化模型工厂：Embedding 模型与 Chat 模型通常来自同一提供商
// 注意：DeepSeek 不提供 embedding，默认用 OpenAI text-embedding-3-small
export function createEmbeddingModel() {
  const provider = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? 'missing',
    baseURL: process.env.OPENAI_BASE_URL,
  });
  return provider.embedding(process.env.AI_EMBEDDING_MODEL ?? 'text-embedding-3-small');
}
