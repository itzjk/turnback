export class InputGate {
  constructor(checkpoint, forward) {
    this.checkpoint = checkpoint;
    this.forward = forward;
    this.pending = [];
    this.pasting = false;
  }

  write(chunk) {
    const markers = [Buffer.from('\x1b[200~'), Buffer.from('\x1b[201~')];
    let outgoing = [];
    const flush = () => {
      if (outgoing.length) this.forward(Buffer.from(outgoing));
      outgoing = [];
    };
    for (const byte of chunk) {
      this.pending.push(byte);
      if (this.pending.length > 6) this.pending.shift();
      const complete = markers.findIndex(marker => marker.equals(Buffer.from(this.pending)));
      if (complete >= 0) this.pasting = complete === 0;
      if (!this.pasting && (byte === 13 || byte === 10)) {
        flush();
        this.checkpoint();
      }
      outgoing.push(byte);
    }
    flush();
  }
}
