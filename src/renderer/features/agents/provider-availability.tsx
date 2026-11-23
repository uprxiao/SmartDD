import type { ReactNode } from 'react';
import { CircleCheck, CircleX, LoaderCircle, RotateCw, Star } from 'lucide-react';
import type { CodeAgentKind } from '@shared/ai-agents';
import './provider-availability.css';

type Availability = 'available' | 'unavailable' | 'untested' | 'unsupported' | 'testing';

export function ProviderAvailabilityTable({ tools, showContext, children }: {
  tools: readonly { kind: CodeAgentKind; label: ReactNode }[];
  showContext: boolean;
  children: ReactNode;
}) {
  return <div className="m13-availability-scroll" role="region" aria-label="模型表格滚动区" tabIndex={0}>
    <table className={'m13-availability-table' + (showContext ? ' has-context' : '') + (tools.length === 3 ? ' three-tools' : '')}
      aria-label="模型可用性">
      <colgroup>
        <col className="m13-availability-model-col"/>
        {showContext && <col className="m13-availability-context-col"/>}
        {tools.map(({ kind }) => <col key={kind}/>)}
      </colgroup>
      <thead><tr>
        <th scope="col">模型</th>
        {showContext && <th scope="col">上下文</th>}
        {tools.map(({ kind, label }) => <th key={kind} scope="col" className="m13-availability-tool">
          <span className="m13-availability-heading">{label}</span>
        </th>)}
      </tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

export function ProviderAvailabilityCell({ tool, state, detail, isDefault, retry, disabled }: {
  tool: CodeAgentKind;
  state: Availability;
  detail?: string;
  isDefault?: boolean;
  retry?: () => void;
  disabled?: boolean;
}) {
  if (state === 'unsupported') {
    const reason = detail || '供应商没有这个工具所需的协议';
    return <td className="m13-availability-tool" title={reason} aria-label={reason}/>;
  }
  const tip = [detail, isDefault && '默认模型'].filter(Boolean).join(' · ');
  if (state === 'untested') {
    return <td className="m13-availability-tool" data-tool={tool} data-avail={state} aria-label="未测试" title={tip || '未测试'}/>;
  }
  const label = state === 'available' ? '可用' : state === 'unavailable' ? '不可用' : '测试中';
  const Icon = state === 'available' ? CircleCheck : state === 'unavailable' ? CircleX : LoaderCircle;
  return <td className="m13-availability-tool" data-tool={tool} data-avail={state} title={tip || label}>
    <span className="m13-availability-icons">
      <Icon size={16} className={state === 'testing' ? 'm13-spin' : 'm13-availability-' + state} role="img" aria-label={label}/>
      {state === 'available' && isDefault && <Star size={13} className="m13-availability-default" role="img" aria-label="默认模型"/>}
      {state === 'unavailable' && <button type="button" className="m13-availability-retry" title="重测" aria-label="重测"
        aria-description={tip || undefined} disabled={disabled} onClick={retry}><RotateCw size={16} aria-hidden="true"/></button>}
    </span>
  </td>;
}

export function RecommendedModelMark() {
  return <span title="推荐"><Star size={13} className="m13-availability-recommended" role="img" aria-label="推荐"/></span>;
}

export function ProviderAvailabilityLegend() {
  return <div className="m13-availability-legend" aria-label="图标说明">
    <span><Star size={13} className="m13-availability-recommended" aria-hidden="true"/>推荐</span>
    <span><Star size={13} className="m13-availability-default" aria-hidden="true"/>默认模型</span>
    <span><CircleCheck size={14} className="m13-availability-available" aria-hidden="true"/>可用</span>
    <span><CircleX size={14} className="m13-availability-unavailable" aria-hidden="true"/>不可用</span>
    <span><RotateCw size={14} className="m13-availability-retry-icon" aria-hidden="true"/>重测</span>
    <span>未测试或缺少协议留空</span>
  </div>;
}
