
class AudioService {
  private audioCtx: AudioContext | null = null;

  private init() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  }

  // 即時的極短嗶聲，用於掃描瞬間的反饋
  playFeedback(type: 'success' | 'error' | 'mapping') {
    this.init();
    if (!this.audioCtx) return;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    
    // 不同類型的聲音頻率
    let freq = 880; // success: 高音
    if (type === 'error') freq = 220; // error: 低音
    if (type === 'mapping') freq = 440; // mapping: 中音

    osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.15);
    
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    
    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.15);
  }

  // 為了保持 App.tsx 相容性，保留這些方法但僅執行嗶聲
  speakSuccess(name: string, qty: number) {
    this.playFeedback('success');
  }

  speakError() {
    this.playFeedback('error');
  }

  speakMappingSuccess() {
    this.playFeedback('mapping');
  }
}

export const audioService = new AudioService();
