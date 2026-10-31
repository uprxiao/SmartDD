import {it,expect} from 'vitest';
import {codexSkillDiscoveryEvidence as parse} from '../codex-skill-discovery-evidence';
const target={id:'mail',nativeName:'owned-mail',path:'/private/中文 path/owned-mail/SKILL.md',content:'not used as discovery'};
const text='<skills_instructions>\n## Skills\n### Skill roots\n- `r0` = `/private/中文 path`\n### Available skills\n- owned-mail: mail description (file: r0/owned-mail/SKILL.md)\n</skills_instructions>';
const row=(body=text,role='developer')=>JSON.stringify({timestamp:new Date(200).toISOString(),type:'response_item',payload:{type:'message',role,content:[{type:'input_text',text:body}]}});
it('records exact native catalog metadata independently of reading',()=>expect(parse([row()],[target],100,300)).toMatchObject([{skillId:'mail',observedAt:new Date(200).toISOString()}]));
it('rejects user/assistant mentions, old and future records',()=>{for(const role of ['user','assistant'])expect(parse([row(text,role)],[target],100,300)).toEqual([]);expect(parse([row()],[target],201,300)).toEqual([]);expect(parse([row()],[target],100,199)).toEqual([]);});
it('rejects wrong root, traversal, duplicate roots/names and multiple catalogs',()=>{for(const body of [text.replace('/private/中文 path','/foreign'),text.replace('r0/owned-mail','r0/../owned-mail'),text.replace('### Available skills','- `r0` = `/foreign`\n### Available skills'),text.replace('</skills_instructions>','- owned-mail: duplicate (file: r0/owned-mail/SKILL.md)\n</skills_instructions>'),text+'\n'+text])expect(parse([row(body)],[target],100,300)).toEqual([]);});
it('keeps exact owned-path evidence when a late user plugin adds another root and a namespaced Skill',()=>{
 const expanded=text.replace('### Available skills','- `r1` = `/private/user plugin "quoted"`\n### Available skills').replace('</skills_instructions>','- late-user:owned-mail: inert user plugin (file: r1/owned-mail/SKILL.md)\n</skills_instructions>');
 expect(parse([row(expanded)],[target],100,300)).toMatchObject([{skillId:'mail',observedAt:new Date(200).toISOString()}]);
 const onlyPlugin=expanded.replace('- owned-mail: mail description (file: r0/owned-mail/SKILL.md)\n','');
 expect(parse([row(onlyPlugin)],[target],100,300)).toEqual([]);
});
