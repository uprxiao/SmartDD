import { describe, expect, it } from 'vitest';
import { browserExecArguments } from '../exec-policy';

describe('fixed agent-browser exec boundary', () => {
  it('preserves quoted selectors and text as argv without evaluating shell syntax', () => {
    expect(browserExecArguments('fill "#field" \'$(touch /tmp/never-run); `id`\''))
      .toEqual(['fill','#field','$(touch /tmp/never-run); `id`']);
    expect(browserExecArguments('fill #field ""')).toEqual(['fill','#field','']);
  });
  it.each([
    '', 'unknown x', 'connect http://127.0.0.1', 'tab new',
    'click @k1s1e1 --cdp=9222', 'snapshot --session foreign',
    'snapshot --headed', 'snapshot --config /tmp/foreign',
    'fill "unterminated', 'fill trailing\\',
  ])('rejects an unknown command, global option or incomplete quoting: %s', source => {
    expect(() => browserExecArguments(source)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});
