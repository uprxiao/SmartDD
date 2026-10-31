import {zentaoDisplayFields} from '../../../src/shared/zentao-presentation';
export const previewZentaoPresentation={available:true,labels:{project:'所属项目',product:'所属产品',module:'所属模块',openedBuild:'影响版本',type:'Bug类型',status:'当前状态',pri:'优先级'},choices:{status:{active:'激活',resolved:'已解决',closed:'已关闭'},pri:{2:'P1',3:'P2'},severity:{3:'较大'},type:{codeerror:'代码错误',story:'研发需求'}}};
export function previewZentaoFields(item,available=true){
 return zentaoDisplayFields({status:({'激活':'active','已解决':'resolved','已关闭':'closed'})[item.state]??item.state,assignedTo:{realname:'演示用户',account:'demo.user'},project:12,projectName:'演示项目',product:8,productName:'演示产品',module:7,moduleTitle:item.module,pri:({'P1':2,'P2':3})[item.priority]??item.priority,...(item.type==='bug'?{severity:3,type:'codeerror',openedBuild:[{id:71,title:'演示版本'}]}:{type:'story'})},available?previewZentaoPresentation:{available:false,labels:{},choices:{}});
}
