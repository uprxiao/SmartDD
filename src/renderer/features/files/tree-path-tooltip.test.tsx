// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTreePathTooltip } from './tree-path-tooltip';

class Pointer extends MouseEvent {
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerType = init.pointerType ?? 'mouse'; }
}
function Fixture({ model = 1 }: { model?: number }) {
  const tip = useTreePathTooltip(model);
  return <><button {...tip.bind('/root/路径🙂.md')}>file<span className="fw-git-state">M</span><input aria-label="action" /><span data-tooltip-ignore>ignored</span></button>{tip.element}</>;
}
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const hover = () => fireEvent.pointerEnter(screen.getByRole('button'), { pointerType: 'mouse' });
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('PointerEvent', Pointer); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('N13 owned path tooltip lifetime', () => {
  it('opens at exactly 500ms, associates the full path, and cancels pending hover on Escape', () => {
    render(<Fixture />); hover(); tick(499); expect(screen.queryByRole('tooltip')).toBeNull(); tick(1);
    const tip = screen.getByRole('tooltip'); expect(tip.textContent).toBe('/root/路径🙂.md'); expect(screen.getByRole('button').getAttribute('aria-describedby')).toBe(tip.id);
    fireEvent.keyDown(window, { key: 'Escape' }); expect(screen.queryByRole('tooltip')).toBeNull();
    hover(); tick(499); fireEvent.keyDown(window, { key: 'Escape' }); tick(1); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it.each(['scroll', 'resize', 'pointerdown'] as const)('%s cancels pending and visible tooltips', type => {
    render(<Fixture />); hover(); tick(200); act(() => { window.dispatchEvent(new Event(type)); }); tick(500); expect(screen.queryByRole('tooltip')).toBeNull();
    hover(); tick(500); expect(screen.getByRole('tooltip')).toBeTruthy(); act(() => { window.dispatchEvent(new Event(type)); }); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('does not trigger from touch, pressed-pointer movement, git, inputs or ignored actions', () => {
    render(<Fixture />); const button = screen.getByRole('button');
    for (const init of [{ pointerType: 'touch' }, { pointerType: 'mouse', buttons: 1 }]) { fireEvent.pointerEnter(button, init); tick(600); expect(screen.queryByRole('tooltip')).toBeNull(); }
    for (const element of [screen.getByText('M'), screen.getByRole('textbox'), screen.getByText('ignored')]) { fireEvent.pointerOver(element, { pointerType: 'mouse' }); tick(600); expect(screen.queryByRole('tooltip')).toBeNull(); }
    hover(); tick(500); fireEvent.pointerMove(screen.getByText('M'), { pointerType: 'mouse' }); expect(screen.queryByRole('tooltip')).toBeNull();
    hover(); tick(500); fireEvent.pointerMove(button, { pointerType: 'mouse', buttons: 1 }); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('focus-visible is gated, and moving focus into selectable tooltip content keeps it available', () => {
    render(<Fixture />); const button = screen.getByRole('button'), original = button.matches.bind(button);
    vi.spyOn(button, 'matches').mockImplementation(selector => selector === ':focus-visible' ? false : original(selector));
    fireEvent.focus(button); tick(500); expect(screen.queryByRole('tooltip')).toBeNull();
    vi.mocked(button.matches).mockImplementation(selector => selector === ':focus-visible' ? true : original(selector));
    fireEvent.focus(button); const tip = screen.getByRole('tooltip');
    fireEvent.pointerLeave(button, { relatedTarget: tip }); fireEvent.blur(button, { relatedTarget: tip }); expect(screen.getByRole('tooltip')).toBe(tip);
    fireEvent.pointerDown(tip); fireEvent.scroll(tip); expect(screen.getByRole('tooltip')).toBe(tip);
    fireEvent.pointerLeave(tip.parentElement!); expect(screen.queryByRole('tooltip')).toBeNull();
    hover(); tick(500); fireEvent.blur(screen.getByRole('tooltip'), { relatedTarget: document.body }); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('allows the pointer to cross the visible gap into selectable content, then closes outside both', () => {
    render(<Fixture />); const button = screen.getByRole('button');
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 210, bottom: 38 } as DOMRect);
    hover(); tick(500); const tip = screen.getByRole('tooltip');
    vi.spyOn(tip, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 43, right: 330, bottom: 95 } as DOMRect);
    const bridge = tip.parentElement!; expect(bridge.style.paddingTop).toBe('5px'); fireEvent.pointerLeave(button, { relatedTarget: bridge }); fireEvent.pointerMove(bridge, { clientX: 100, clientY: 40 });
    expect(screen.getByRole('tooltip')).toBe(tip); fireEvent.pointerEnter(tip); fireEvent.pointerMove(tip, { clientX: 100, clientY: 50 }); expect(screen.getByRole('tooltip')).toBe(tip);
    fireEvent.pointerLeave(bridge, { relatedTarget: document.body }); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('excludes an input retargeted through a decoration shadow root', () => {
    render(<Fixture />); const host = document.createElement('span'); screen.getByRole('button').append(host);
    const shadow = host.attachShadow({ mode: 'open' }), input = document.createElement('input'); shadow.append(input);
    fireEvent(input, new Pointer('pointerover', { bubbles: true, composed: true })); tick(500); expect(screen.queryByRole('tooltip')).toBeNull();
  });
  it('clears stale model paths and removes pending timers on unmount', () => {
    const view = render(<Fixture />); hover(); tick(500); view.rerender(<Fixture model={2} />); expect(screen.queryByRole('tooltip')).toBeNull();
    hover(); tick(200); view.unmount(); expect(vi.getTimerCount()).toBe(0); tick(500); expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
