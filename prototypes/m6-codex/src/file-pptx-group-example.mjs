// Synthetic JSON for the prototype; this is not an OOXML file or an App host.
export const pptxGroupExample = JSON.stringify({ slides: [{
  id: 'group-slide', title: '组合对象示例（合成）', notes: '组坐标与子对象局部坐标分别保存。',
  background: '#ffffff', elements: [
    { id: 'group-heading', kind: 'text', text: '组合对象 · 合成示例', x: 48, y: 28, width: 520, height: 50, fontSize: 26, color: '#203c3b', fill: 'transparent' },
    { id: 'group-example', kind: 'group', x: 100, y: 130, width: 300, height: 160,
      childFrame: { x: 0, y: 0, width: 300, height: 160 }, children: [
        { id: 'group-child-title', kind: 'text', text: '组内标题', x: 12, y: 12, width: 260, height: 44, fontSize: 24, bold: true, color: '#203c3b', fill: 'transparent' },
        { id: 'group-child-shape', kind: 'shape', shape: 'rect', text: '局部坐标保持', x: 12, y: 80, width: 260, height: 56, fontSize: 18, color: '#106c61', fill: '#d9efea' }
      ] },
    { id: 'group-unselected', kind: 'shape', shape: 'rect', text: '独立对象', x: 460, y: 320, width: 160, height: 60, fontSize: 18, color: '#465856', fill: '#eef3f0' }
  ]
}] });
