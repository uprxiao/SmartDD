const units=length=>'😀\r\n'+'x'.repeat(length-4);
const lines=count=>'中文🙂\r\n'+Array(count-1).fill('x').join('\r\n');
const heavy=character=>character+character.toLowerCase().repeat(2195)+'\r\n'+Array(4999).fill(character+character.toLowerCase().repeat(49)).join('\r\n');
export const inlineDiffFixtures=[
 {id:'units-equal',local:'L'+units(262143),disk:'D'+units(262143),enabled:true},
 {id:'units-local-over',local:'L'+units(262144),disk:'D'+units(262143),enabled:false},
 {id:'units-disk-over',local:'L'+units(262143),disk:'D'+units(262144),enabled:false},
 {id:'lines-equal',local:'L'+lines(5000),disk:'D'+lines(5000),enabled:true},
 {id:'lines-local-over',local:'L'+lines(5001),disk:'D'+lines(5000),enabled:false},
 {id:'lines-disk-over',local:'L'+lines(5000),disk:'D'+lines(5001),enabled:false},
 {id:'both-limits-heavy',local:heavy('L'),disk:heavy('D'),enabled:true},
].map(row=>({...row,base:'B'+row.local.slice(1)}));
export function verifyInlineDiffFixture(row){
 const [local,disk]=({'units-equal':[262144,262144],'units-local-over':[262145,262144],'units-disk-over':[262144,262145],'lines-equal':[5000,5000],'lines-local-over':[5001,5000],'lines-disk-over':[5000,5001],'both-limits-heavy':[5000,5000]})[row.id];
 const measure=text=>row.id.startsWith('units')?text.length:text.split(/\r\n?|\n/).length;
 if(measure(row.local)!==local||measure(row.disk)!==disk||row.base.slice(1)!==row.local.slice(1))throw Error('Invalid H33 boundary fixture '+row.id);
 if(row.id==='both-limits-heavy'&&(row.local.length!==262144||row.disk.length!==262144))throw Error('Invalid heavy H33 UTF16 boundary');
 return{measure:row.id.startsWith('units')?'UTF16':'lines',local,disk,units:{local:row.local.length,disk:row.disk.length}};
}
