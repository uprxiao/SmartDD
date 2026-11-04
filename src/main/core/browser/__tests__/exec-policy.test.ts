import { describe, expect, it } from 'vitest';
import { browserExecArguments } from '../exec-policy';

describe('fixed agent-browser exec boundary', () => {
  it('preserves quoted selectors and text as argv without evaluating shell syntax', () => {
    expect(browserExecArguments('fill "#field" \'$(touch /tmp/never-run); `id`\''))
      .toEqual(['fill','#field','$(touch /tmp/never-run); `id`']);
    expect(browserExecArguments('fill #field ""')).toEqual(['fill','#field','']);
  });
  it('allows only documented set/cookies subcommands, including the default cookie read, without permitting file import',()=>{
    expect(browserExecArguments('cookies')).toEqual(['cookies']);expect(browserExecArguments('cookies --url https://fixture.test')).toEqual(['cookies','--url','https://fixture.test']);expect(browserExecArguments('cookies get')).toEqual(['cookies','get']);expect(browserExecArguments('cookies set name value --secure')).toEqual(['cookies','set','name','value','--secure']);expect(browserExecArguments('set viewport 800 600')).toEqual(['set','viewport','800','600']);expect(browserExecArguments('set geo 1 2')).toEqual(['set','geo','1','2']);
    for(const command of['cookies import /private/input.json','cookies set --curl /private/input.json','set permissions geolocation','set ignore-https-errors true','set unknown x'])expect(()=>browserExecArguments(command)).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
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
