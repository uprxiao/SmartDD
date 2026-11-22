import { useState } from 'react';
import { Search } from 'lucide-react';
import type { ProviderCatalogModel } from '@shared/provider-model-metadata';
import './provider-model-picker.css';

const filters = [
  { value: 'conversation', label: '对话与编程' },
  { value: 'all', label: '全部' },
  { value: 'selected', label: '已选' },
] as const;

const purposeLabels = {
  conversation: '对话',
  image: '图像',
  video: '视频',
  audio: '语音',
  embedding: '向量',
};

export function ProviderModelPicker({ models, picked, onPick, busy }: {
  models: Pick<ProviderCatalogModel, 'id' | 'name' | 'vendor' | 'purpose'>[];
  picked: string[];
  onPick: (ids: string[]) => void;
  busy: boolean;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]['value']>('conversation');
  const [query, setQuery] = useState('');
  const [vendor, setVendor] = useState('');
  const selected = new Set(picked);
  const owners = [...new Set(models.flatMap(model => model.vendor ? [model.vendor] : []))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const term = query.trim().toLowerCase();
  const visible = models.filter(model =>
    (filter !== 'conversation' || !model.purpose || model.purpose === 'conversation') &&
    (filter !== 'selected' || selected.has(model.id)) &&
    (!vendor || vendor === (model.vendor ?? '其他')) &&
    (!term || model.name.toLowerCase().includes(term) || model.id.toLowerCase().includes(term)));
  const allVisibleSelected = visible.every(model => selected.has(model.id));

  return <section className="m13-fetched m13-model-picker" aria-label="选择模型">
    <div className="m13-model-picker-head">
      <h3 className="m13-sub">已获取 {models.length} 个模型</h3>
      <span role="status">已选 {picked.length} 个</span>
    </div>
    <div className="m13-model-picker-tools">
      <div className="m13-proto-tabs" role="group" aria-label="模型范围">
        {filters.map(option => <button type="button" key={option.value} aria-pressed={filter === option.value}
          onClick={() => setFilter(option.value)}>{option.label}</button>)}
      </div>
      <select className="m13-input" aria-label="厂商" value={vendor} onChange={event => setVendor(event.target.value)}>
        <option value="">全部厂商</option>
        {owners.map(owner => <option key={owner} value={owner}>{owner}</option>)}
        {models.some(model => !model.vendor) && <option value="其他">其他</option>}
      </select>
    </div>
    <div className="m13-model-picker-tools">
      <label className="m13-model-picker-search">
        <Search size={14} aria-hidden="true"/>
        <input className="m13-input" aria-label="搜索模型" placeholder="搜索模型" value={query}
          onChange={event => setQuery(event.target.value)}/>
      </label>
      <button type="button" className="m13-link" disabled={busy || allVisibleSelected}
        onClick={() => onPick([...new Set([...picked, ...visible.map(model => model.id)])])}>选择筛选结果</button>
      <button type="button" className="m13-link" disabled={busy || !picked.length} onClick={() => onPick([])}>清空</button>
    </div>
    <div className="m13-model-picker-scroll">
      <table aria-label="模型列表">
        <thead><tr><th scope="col">模型</th><th scope="col">厂商</th><th scope="col">用途</th></tr></thead>
        <tbody>
          {visible.map(model => <tr key={model.id}>
            <td><label title={model.id}><input type="checkbox" checked={selected.has(model.id)} disabled={busy}
              onChange={event => onPick(event.target.checked ? [...picked, model.id] : picked.filter(id => id !== model.id))}/>
            <span>{model.name}</span></label></td>
            <td title={model.vendor}>{model.vendor ?? '其他'}</td>
            <td>{model.purpose ? purposeLabels[model.purpose] : '待确认'}</td>
          </tr>)}
          {!visible.length && <tr><td colSpan={3} className="m13-model-picker-empty">没有符合条件的模型</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}
