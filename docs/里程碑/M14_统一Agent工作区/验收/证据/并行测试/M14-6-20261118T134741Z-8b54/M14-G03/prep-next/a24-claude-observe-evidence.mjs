// Match the exact native request and receipt. Prompt history may mention the same marker.
export function observeReceipts(messages, childTaskId, marker) {
  const ids = new Set();
  const results = [];
  for(const message of messages) {
    if(!Array.isArray(message?.content)) continue;
    for (const block of message.content) {
      if (block?.type==='tool_use' && typeof block.name==='string' && block.name.endsWith('__wy_observe') && typeof block.id==='string') ids.add(block.id);
      if (block?.type!=='tool_result'||!ids.has(block.tool_use_id)) continue;
      const pieces = typeof block.content==='string' ? [block.content]
        : Array.isArray(block.content) ? block.content.filter(x=>x?.type==='text').map(x=>x.text) : [];
      const parsed = pieces.flatMap(piece=>{try{return [JSON.parse(piece)];}catch{return [];}});
      const value = parsed.flatMap(item=>item?.children??item?.value?.children??[])
        .find(child=>child?.childTaskId===childTaskId&&child?.resultRevision===1&&child?.body?.chunk?.includes(marker));
      results.push({ id:block.tool_use_id, error:block.is_error===true, matched:!!value,
        ...(block.is_error===true&&pieces.length?{errorText:pieces.join(' ').slice(0,200)}:{}) });
    }
  }
  return results;
}
