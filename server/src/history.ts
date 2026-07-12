import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { RunRecord } from '@voice-lab/shared';

export interface History {
  appendRun(run: RunRecord): Promise<void>;
  listRuns(): Promise<RunRecord[]>;
  saveAudio(fileName: string, data: Buffer): Promise<void>;
  audioDir: string;
}

/** 一意な実行 ID を作る */
export function newRunId(): string {
  return randomUUID();
}

/**
 * data ディレクトリ（runs.jsonl + audio/）を使ったフラットファイル履歴。
 */
export function createHistory(dataDir: string): History {
  const runsFile = join(dataDir, 'runs.jsonl');
  const audioDir = join(dataDir, 'audio');
  const ensure = async () => {
    await mkdir(audioDir, { recursive: true });
  };
  return {
    audioDir,
    async appendRun(run) {
      await ensure();
      await appendFile(runsFile, JSON.stringify(run) + '\n', 'utf8');
    },
    async listRuns() {
      await ensure();
      const text = await readFile(runsFile, 'utf8').catch(() => '');
      return text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as RunRecord)
        .reverse();
    },
    async saveAudio(fileName, data) {
      await ensure();
      await writeFile(join(audioDir, fileName), data);
    },
  };
}
