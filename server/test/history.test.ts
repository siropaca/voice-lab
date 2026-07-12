import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHistory, newRunId } from '../src/history.js';

describe('history', () => {
  it('append した run が新しい順で list される', async () => {
    const h = createHistory(mkdtempSync(join(tmpdir(), 'vl-')));
    await h.appendRun({ id: '1', kind: 'tts', at: '2026-07-12T00:00:00Z', modelKey: 'a', text: 't', voice: 'v', params: {} });
    await h.appendRun({ id: '2', kind: 'stt', at: '2026-07-12T00:01:00Z', models: {} });
    const runs = await h.listRuns();
    expect(runs.map((r) => r.id)).toEqual(['2', '1']);
  });

  it('データディレクトリが無ければ作る・空なら空配列', async () => {
    const h = createHistory(join(mkdtempSync(join(tmpdir(), 'vl-')), 'nested'));
    expect(await h.listRuns()).toEqual([]);
  });

  it('saveAudio でファイルが audioDir に書かれる', async () => {
    const h = createHistory(mkdtempSync(join(tmpdir(), 'vl-')));
    await h.saveAudio('x.wav', Buffer.from([1]));
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(h.audioDir, 'x.wav'))[0]).toBe(1);
  });

  it('newRunId は一意', () => {
    expect(newRunId()).not.toBe(newRunId());
  });
});
