import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface Criterion {
  name: string;
  description: string;
  weight?: number; // 默认 1
}

export interface EvalCase {
  id: string;
  input: string;
  context?: string;
  criteria: Criterion[];
}

const here = dirname(fileURLToPath(import.meta.url));

export function loadDataset(file = 'sample/dataset.json'): EvalCase[] {
  const abs = join(here, '..', file);
  const raw = readFileSync(abs, 'utf8');
  return JSON.parse(raw) as EvalCase[];
}
