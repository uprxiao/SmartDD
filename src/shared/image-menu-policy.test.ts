import { describe, expect, it } from 'vitest';
import { imageMenuActions, isImageWebAddress } from './image-menu-policy.mjs';

describe('image address selection from source and display URLs', () => {
  it.each([
    ['http://', 'https://example.invalid/display.png', 'https://example.invalid/display.png'],
    ['data:image/png;base64,AA==', 'https://example.invalid/display.png', 'https://example.invalid/display.png'],
    ['http://example.invalid/source.png', 'https://example.invalid/display.png', 'http://example.invalid/source.png'],
    ['https://bad host/image.png', 'https://example.invalid/display.png', 'https://example.invalid/display.png'],
    ['file:///fixture/image.png', 'blob:fixture', null],
    ['data:image/png;base64,AA==', '', null],
    ['not a URL', '', null],
    ['http://', '', null],
    ['HTTPS://EXAMPLE.invalid/image.png?x=1#part', '', 'HTTPS://EXAMPLE.invalid/image.png?x=1#part'],
    ['http:example.invalid/image.png', '', 'http:example.invalid/image.png'],
  ])('selects the first valid web URL from %j and %j', (src, displaySrc, expected) => {
    const address = imageMenuActions({ src: src!, displaySrc: displaySrc!, canSelect: false, canCopy: false, clipboard: false }).filter(action => action.id === 'address');
    expect(address.map(action => action.value)).toEqual(expected === null ? [] : [expected]);
    // The action guard must accept exactly the original selected URL, too.
    if (expected !== null) expect(isImageWebAddress(expected)).toBe(true);
  });

  it('rejects invalid authorities, other protocols and non-string input', () => {
    for (const value of ['http://', 'https://bad host/image.png', 'file:///fixture/image.png', 'data:image/png;base64,AA==', 'blob:fixture', undefined, null, {}]) expect(isImageWebAddress(value)).toBe(false);
  });

  it('preserves menu order and capability filters when an invalid source has a valid display URL', () => {
    const actions = imageMenuActions({ src: 'http://', displaySrc: 'https://example.invalid/image.gif', localPath: '/fixture/image.gif', animated: true });
    expect(actions.map(action => action.id)).toEqual(['open', 'address', 'reveal', 'download']);
    expect(actions[1].value).toBe('https://example.invalid/image.gif');
  });
});
