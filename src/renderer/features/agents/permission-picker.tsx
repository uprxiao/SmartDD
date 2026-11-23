import { Menu } from '@base-ui/react/menu';
import { Check, ChevronDown } from 'lucide-react';
import type { AgentPermission } from '@shared/agent-permissions';
import { PermIcon } from './icons';
import { permissionLabels } from './permission-labels';
import './permission-picker.css';

export function PermissionPicker({ selected, effective = selected, allowAuto, changing, deferred, disabled, title, testId, task, onPick }: {
  selected: AgentPermission;
  effective?: AgentPermission;
  allowAuto: boolean;
  changing?: boolean;
  deferred?: boolean;
  disabled?: boolean;
  title?: string;
  testId?: string;
  task?: boolean;
  onPick(tier: AgentPermission): void;
}) {
  const options: AgentPermission[] = allowAuto ? ['ask', 'auto', 'full'] : ['ask', 'full'];
  const current = permissionLabels[effective];
  const status = changing ? '正在切换' : deferred ? '下轮生效' : null;
  return <div className="wy-permission-picker">
    <Menu.Root>
      <Menu.Trigger type="button" disabled={disabled} title={title} data-testid={testId}
        className={'wy-permission-trigger' + (effective === 'full' ? ' danger' : '')}
        aria-label={task ? '权限档位' : `权限：${current.name}`}>
        <PermIcon icon={current.icon} size={15}/><span>{current.name}</span>
        <ChevronDown size={12} aria-hidden="true"/>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" align="start" sideOffset={7} className="wy-permission-positioner">
          <Menu.Popup className="wy-permission-menu" aria-label="权限">
            {options.map(id => {
              const option = permissionLabels[id];
              return <Menu.Item render={<button type="button"/>} key={id} role="menuitemradio" aria-checked={selected === id}
                className={'wy-permission-option' + (id === 'full' ? ' danger' : '')} onClick={() => onPick(id)}>
                <PermIcon icon={option.icon}/>
                <span><strong>{option.name}</strong><small>{allowAuto ? option.desc : option.otherDesc}</small></span>
                {id === selected && <Check size={15} className="wy-permission-check" aria-hidden="true"/>}
              </Menu.Item>;
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    {status && <span className="wy-permission-status" role="status" title={permissionLabels[selected].name}>
      {status} · {permissionLabels[selected].name}
    </span>}
  </div>;
}
