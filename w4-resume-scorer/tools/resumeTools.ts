import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sampleDir = join(here, '..', 'sample');

// 工具 1：读取简历（演示「多步编排」第一步——Agent 主动读取数据源）
export const readResume = createTool({
  id: 'readResume',
  description: '读取候选人简历文本，文件位于 sample/resume.txt',
  inputSchema: z.object({}),
  execute: async () => {
    const resume = await readFile(join(sampleDir, 'resume.txt'), 'utf-8');
    return { resume };
  },
});

// 工具 2：读取岗位 JD（演示「多步编排」第二步——抓取目标岗位要求）
export const readJobDescription = createTool({
  id: 'readJobDescription',
  description: '读取目标岗位的 JD 文本，文件位于 sample/jd.txt',
  inputSchema: z.object({}),
  execute: async () => {
    const jobDescription = await readFile(join(sampleDir, 'jd.txt'), 'utf-8');
    return { jobDescription };
  },
});
