/**
 * mp3 の NDJSON チャンクを MediaSource に流し込む逐次再生プレイヤー。
 * appendChunk はキューイングし、SourceBuffer の updateend で順次 append する。
 */
export class MsePlayer {
  readonly audioEl: HTMLAudioElement;
  private mediaSource = new MediaSource();
  private sourceBuffer: SourceBuffer | null = null;
  private queue: ArrayBuffer[] = [];
  private ended = false;

  constructor() {
    this.audioEl = document.createElement('audio');
    this.audioEl.preload = 'auto';
    this.audioEl.src = URL.createObjectURL(this.mediaSource);
    this.mediaSource.addEventListener('sourceopen', () => {
      try {
        this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');
        this.sourceBuffer.addEventListener('updateend', () => this.pump());
        this.pump();
      } catch {
        /* mpeg 非対応環境では audioEl の src 直接再生にフォールバックできないが、Chrome では対応 */
      }
    });
  }

  /** base64 の mp3 チャンクを追加する */
  appendChunk(b64: string) {
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    this.queue.push(buf);
    this.pump();
  }

  /** これ以上チャンクが来ないことを通知する */
  endOfStream() {
    this.ended = true;
    this.pump();
  }

  /** 再生を開始する */
  async play() {
    await this.audioEl.play();
  }

  private pump() {
    if (!this.sourceBuffer || this.sourceBuffer.updating) return;
    const next = this.queue.shift();
    if (next) {
      try {
        this.sourceBuffer.appendBuffer(next);
      } catch {
        /* QuotaExceeded 等は無視（実験ツール） */
      }
    } else if (this.ended && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch {
        /* already ended */
      }
    }
  }
}
