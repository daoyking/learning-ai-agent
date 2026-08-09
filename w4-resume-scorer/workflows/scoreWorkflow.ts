import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resumeScorer } from '../agents/resumeScorer.js';

const here = dirname(fileURLToPath(import.meta.url));
const sampleDir = join(here, '..', 'sample');

// 步骤 1：并行读取简历与 JD（数据加载）
const loadData = createStep({
  id: 'loadData',
  inputSchema: z.object({}),
  outputSchema: z.object({ resume: z.string(), jobDescription: z.string() }),
  execute: async () => {
    const [resume, jobDescription] = await Promise.all([
      readFile(join(sampleDir, 'resume.txt'), 'utf-8'),
      readFile(join(sampleDir, 'jd.txt'), 'utf-8'),
    ]);
    return { resume, jobDescription };
  },
});

// 步骤 2：调用 Agent 打分（依赖步骤 1 的输出）
const scoreStep = createStep({
  id: 'score',
  inputSchema: z.object({ resume: z.string(), jobDescription: z.string() }),
  outputSchema: z.object({ report: z.string() }),
  execute: async ({ inputData }) => {
    const { resume, jobDescription } = inputData;
    const result = await resumeScorer.generate(
      `简历：\n${resume}\n\n目标岗位 JD：\n${jobDescription}\n\n请按 5 个维度打分并给出最优先的 3 条改进建议，用中文 Markdown 输出。`,
    );
    return { report: result.text };
  },
});

// 显式编排：loadData → score（链式 .then() + .commit() 构建执行流）
export const scoreWorkflow = createWorkflow({
  id: 'resume-score',
  inputSchema: z.object({}),
  outputSchema: z.object({ report: z.string() }),
})
  .then(loadData)
  .then(scoreStep)
  .commit();
