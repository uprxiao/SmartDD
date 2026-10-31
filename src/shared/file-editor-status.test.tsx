// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileEditorStatus } from './file-editor-status';

afterEach(cleanup);
const props = () => ({ canUndo: false, canRedo: false, onUndo: vi.fn(), onRedo: vi.fn() });

describe('N09 optional host-owned Vim mode presentation', () => {
  it('keeps an absent or blank mode out of the ordinary clean editor', () => {
    const actions = props(), view = render(<FileEditorStatus {...actions} />);
    expect(view.container.childElementCount).toBe(0);
    for (const vimMode of [null, '', '  ']) {
      view.rerender(<FileEditorStatus {...actions} vimMode={vimMode} />);
      expect(view.container.childElementCount).toBe(0);
    }
    expect(actions.onUndo).not.toHaveBeenCalled();
    expect(actions.onRedo).not.toHaveBeenCalled();
  });

  it('follows an explicit read-only host label and removes it when the host detaches', () => {
    const actions = props(), view = render(<FileEditorStatus {...actions} vimMode="NORMAL" />);
    expect(screen.getByRole('status', { name: 'Vim 模式' }).textContent).toBe('NORMAL');
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '重做' }).hasAttribute('disabled')).toBe(true);
    view.rerender(<FileEditorStatus {...actions} vimMode="VISUAL BLOCK" />);
    expect(screen.getByRole('status', { name: 'Vim 模式' }).textContent).toBe('VISUAL BLOCK');
    expect(screen.queryByText('NORMAL')).toBeNull();
    view.rerender(<FileEditorStatus {...actions} vimMode={null} />);
    expect(view.container.childElementCount).toBe(0);
    expect(actions.onUndo).not.toHaveBeenCalled();
    expect(actions.onRedo).not.toHaveBeenCalled();
  });

  it('preserves history actions, focus and saving/error precedence alongside the mode', () => {
    const actions = props(), view = render(<FileEditorStatus {...actions} canUndo vimMode="INSERT" saving error="原保存错误" />);
    expect(screen.getByText('正在保存…')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const undo = screen.getByRole('button', { name: '撤销' });
    expect(fireEvent.mouseDown(undo)).toBe(false);
    fireEvent.click(undo);
    expect(actions.onUndo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(actions.onRedo).not.toHaveBeenCalled();
    view.rerender(<FileEditorStatus {...actions} canRedo vimMode="NORMAL" error="原保存错误" />);
    // The reference floater has a fixed status; retain actual failure details
    // in its tooltip, alongside the editor's existing full error strip.
    expect(screen.getByRole('alert').textContent).toBe('保存失败');
    expect(screen.getByRole('alert').title).toBe('原保存错误');
    expect(screen.queryByText('正在保存…')).toBeNull();
    expect(screen.getByRole('status', { name: 'Vim 模式' }).textContent).toBe('NORMAL');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(actions.onRedo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '重做' }).classList.contains('fw-editor-status-redo')).toBe(true);
    view.rerender(<FileEditorStatus {...actions} canUndo canRedo disabled vimMode="NORMAL" />);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(actions.onUndo).toHaveBeenCalledTimes(1);
    expect(actions.onRedo).toHaveBeenCalledTimes(1);
  });
});
