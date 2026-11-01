import { ApplicationError } from '@shared/applications';
import { zentaoConfigSchema } from '@shared/application-connections';
import type { LegacyCapabilityPolicy } from '@shared/application-capabilities';
import { ZentaoDataService } from '../../zentao-data-service';
import { ZentaoClient } from '../../providers/zentao';
import type { ApplicationModuleDefinition, ApplicationProviderDefinition } from '../registry';
import {retainedConfigViewDefinitions} from '../retained-config-views';
import {zentaoConnectionNotice} from './run-policy';

const legacy: Readonly<Record<string, string>> = {
  smartdd_zentao_work_list_v1: 'zentao.object.list',
  smartdd_zentao_object_get_v1: 'zentao.object.get',
  smartdd_zentao_resource_v1: 'zentao.resource.read',
};
export const zentaoModule: ApplicationModuleDefinition<'zentao', readonly [ApplicationProviderDefinition<typeof zentaoConfigSchema, 'zentao', 'zentao'>]> = {
  appId: 'zentao', contractMajors: [1], slots: ['zentao'], stopBeforeSwitch: true,
  presentation: { displayName: '禅道', heading: '查看指派给我的 Bug 和研发需求', mark: 'zigzag', projectNote: '每项目仅一个生效连接；停用或认证失败不会自动切换账号。', emptyConnectionSuffix: '', defaultProvider: 'zentao', panel: 'zentao-work', switchTitle: '切换项目禅道连接' },
  providers: [{
    id: 'zentao', appId: 'zentao', configApiMajor: 1, configSchema: zentaoConfigSchema,
    configViews: retainedConfigViewDefinitions.filter(v=>v.providerId==='zentao'),
    authentication: { kind: 'secret', modes: ['token', 'password'] }, permissions: { read: 'zentao.read', write: 'zentao.read' },
    presentation: {
      id: 'zentao', appId: 'zentao', title: '禅道', diagnosticTitle: '禅道连接', initial: { kind: 'zentao', baseUrl: '', username: '', authMode: 'token' },
      icon: 'link', summaryFields: ['username', 'baseUrl'], locationField: 'baseUrl',
      project: { title: '禅道连接', unselectedNote: '查询时提示来源未配置，不自动选择其他连接。' },
      groups: [
        { key: 'baseUrl', title: '服务地址', label: '禅道服务地址', type: 'url', format: 'http-base-url', required: true, immutable: true, placeholder: 'https://zentao.example.com/', validation: '请填写不含凭据、查询参数或片段的 HTTP(S) 服务地址。' },
        { key: 'username', title: '账号', label: '禅道账号', type: 'text', required: true, immutable: true, autoComplete: 'off', validation: '请输入有效的用户名。' },
        { key: 'authMode', title: '认证方式', label: '禅道认证方式', type: 'select', options: [{ value: 'token', label: 'Token' }, { value: 'password', label: '密码' }], validation: '不支持的禅道认证方式。' },
      ],
      secret: { title: '认证密码', conditionalTitle: { field: 'authMode', value: 'token', title: 'Token' }, authModeValidation: '不支持的禅道认证方式。' },
    },
    async verify(value, secret, signal) { const client = new ZentaoClient(zentaoConfigSchema.parse(value), secret); try { return await client.verify(signal); } finally { client.close(); } },
  }],
  legacyPolicy(tool): LegacyCapabilityPolicy {
    const id = legacy[tool.name];
    if (!id) throw new ApplicationError('HOST_INCOMPATIBLE', '该旧禅道工具没有受信业务映射');
    return { id, semantics: 'read', retry: 'safe-read', slots: { required: ['zentao'], conditional: [] } };
  },
  connectionNotice:zentaoConnectionNotice,
  createData: services => new ZentaoDataService(services.contexts, services.resources, services.selections),
};
