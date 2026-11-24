import { Paperclip, Plus, Target, X } from 'lucide-react';
import { useRef } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import './composer-add-menu.css';

export const GOAL_PLACEHOLDER = '描述目标和可验证的完成条件';

export function ComposerAddMenu({ addLabel = '添加', filesLabel = '图片和文件', disabled, onFiles, onGoal }: {
  addLabel?: string;
  filesLabel?: string;
  disabled?: boolean;
  onFiles(files: File[]): void;
  onGoal?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input ref={input} type="file" hidden multiple onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      if (files.length) onFiles(files);
    }} />
    <DropdownMenu>
      <DropdownMenuTrigger className="composer-add-trigger" aria-label={addLabel} data-testid="composer-add" disabled={disabled}>
        <Plus size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuItem onClick={() => input.current?.click()}><Paperclip />{filesLabel}</DropdownMenuItem>
        {onGoal && <DropdownMenuItem onClick={onGoal}>
          <Target /><span>目标</span><span className="composer-add-hint">设置要持续追求的目标</span>
        </DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}

export function ComposerGoalMode({ onExit, disabled }: { onExit(): void; disabled?: boolean }) {
  return <button type="button" className="composer-goal-mode" data-testid="composer-goal-mode"
    aria-label="退出目标模式" title="退出目标模式" onClick={onExit} disabled={disabled}>
    <Target size={14} />目标<X size={12} />
  </button>;
}
