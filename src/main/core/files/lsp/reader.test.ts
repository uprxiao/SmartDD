import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { LspMessageReader } from './reader';
describe('bounded LSP byte framing', () => {
  it('accepts fragmented multibyte UTF-8, case-insensitive headers and multiple frames', () => {
    const input = new PassThrough(), reader = new LspMessageReader(input), receive = vi.fn(); reader.listen(receive);
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '中文🙂' })), frame = Buffer.concat([Buffer.from(`content-length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`), body]);
    for (const byte of frame) input.write(Buffer.from([byte])); input.write(Buffer.concat([frame,frame])); expect(receive).toHaveBeenCalledTimes(3); expect(receive.mock.calls[0][0].result).toBe('中文🙂'); reader.dispose();
  });
  it.each(['Content-Length: 1048577\r\n\r\n', 'Content-Length: 2\r\nContent-Length: 2\r\n\r\n{}', 'Content-Length: -1\r\n\r\n', 'X'.repeat(8193), 'Content-Length: 2\r\n\r\n{}'])('fails closed before exposing invalid frame %#', frame => {
    const input = new PassThrough(), reader = new LspMessageReader(input), receive = vi.fn(), error = vi.fn(); reader.onError(error); reader.listen(receive); input.write(frame); expect(error).toHaveBeenCalledTimes(1); expect(receive).not.toHaveBeenCalled(); input.write('Content-Length: 17\r\n\r\n{"jsonrpc":"2.0"}'); expect(receive).not.toHaveBeenCalled(); reader.dispose();
  });
});
