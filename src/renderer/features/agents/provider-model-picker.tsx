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

type ModelMetadata = Pick<ProviderCatalogModel, 'id' | 'name' | 'vendor' | 'purpose'>;

const matchesQuery = (model: ModelMetadata, term: string) =>
  model.name.toLowerCase().includes(term) || model.id.toLowerCase().includes(term);
const vendorsOf = (models: ModelMetadata[]) => [...new Set(models.map(model => model.vendor ?? '其他'))]
  .sort((a, b) => a.localeCompare(b, 'zh-CN'));

export type ModelCatalogFilters = { query: string; vendor: string; purpose: string };

export function ProviderModelCandidates({ models, picked, filters, onFilters, onToggle, busy, loaded }: {
  models: ModelMetadata[];
  picked: Set<string>;
  filters: ModelCatalogFilters;
  onFilters: (filters: ModelCatalogFilters) => void;
  onToggle: (id: string, checked: boolean) => void;
  busy: boolean;
  loaded: boolean;
}) {
  const term = filters.query.trim().toLowerCase();
  const owners = vendorsOf(models);
  const visible = models.filter(model => matchesQuery(model, term) &&
    (!filters.vendor || filters.vendor === (model.vendor ?? '其他')) &&
    (!filters.purpose || filters.purpose === (model.purpose ?? 'unknown')));
  const empty = !loaded ? '点击「刷新模型」获取目录。' : !models.length ? '没有未接入的模型。' : '没有符合条件的模型。';
  return <div className="m13-model-picker m13-model-candidates">
    <div className="m13-model-picker-tools">
      <label className="m13-model-picker-search">
        <Search size={14} aria-hidden="true"/>
        <input className="m13-input" aria-label="搜索模型" placeholder="搜索模型" value={filters.query}
          onChange={e=>onFilters({...filters,query:e.target.value})}/>
      </label>
      <select className="m13-input" aria-label="厂商" value={filters.vendor} onChange={e=>onFilters({...filters,vendor:e.target.value})}>
        <option value="">全部厂商</option>
        {filters.vendor&&!owners.includes(filters.vendor)&&<option>{filters.vendor}</option>}
        {owners.map(owner=><option key={owner}>{owner}</option>)}
      </select>
      <select className="m13-input" aria-label="用途" value={filters.purpose} onChange={e=>onFilters({...filters,purpose:e.target.value})}>
        <option value="">全部用途</option>
        {Object.entries(purposeLabels).map(([id,label])=><option key={id} value={id}>{id==='conversation'?'对话与编程':label}</option>)}
        <option value="unknown">待确认</option>
      </select>
    </div>
    <div className="m13-model-picker-scroll">
      <table aria-label="未选模型">
        <thead><tr><th scope="col">模型</th><th scope="col">厂商</th><th scope="col">用途</th><th scope="col">状态</th></tr></thead>
        <tbody>
          {visible.map(model=><tr key={model.id} data-model={model.id}>
            <td><label title={model.id}><input type="checkbox" checked={picked.has(model.id)} disabled={busy}
              onChange={e=>onToggle(model.id,e.target.checked)}/><span>{model.name}</span></label></td>
            <td title={model.vendor}>{model.vendor??'其他'}</td>
            <td>{model.purpose==='conversation'?'对话与编程':model.purpose?purposeLabels[model.purpose]:'待确认'}</td>
            <td>{picked.has(model.id)&&<span className="m13-model-pending">待接入</span>}</td>
          </tr>)}
          {!visible.length&&<tr><td colSpan={4} className="m13-model-picker-empty">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

export function ProviderModelPicker({ models, picked, onPick, busy }: {
  models: ModelMetadata[];
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
    matchesQuery(model, term));
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
