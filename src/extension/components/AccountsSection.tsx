// 配置管理页「账号管理」子模块：跨项目/环境扁平展示账号列表，支持按分组/项目/环境/关键字筛选，
// 并提供新增、编辑、设默认、删除等操作。
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { AccountEditorModal } from '../../shared/AccountEditorModal';
import { saveAccount, removeAccount } from '../../shared/config-ops';
import { DEFAULT_PROJECT_GROUP_CODE } from '../../shared/defaults';
import { accountInfoText, accountSearchText, type ToastVariant } from '../helpers';
import { BatchAddAccountsModal } from './BatchAddAccountsModal';
import type { AccountRecord, AppConfig, EnvConfig, ProjectConfig } from '../../shared/types';

type AccountsSectionProps = {
  config: AppConfig;
  persist: (next: AppConfig, status?: string) => Promise<void>;
  showToast: (target: HTMLElement, message: string, variant?: ToastVariant) => void;
};

/**
 * 账号管理区。
 * @param config 当前完整配置。
 * @param persist 持久化整份配置并提示状态。
 */
export function AccountsSection({ config, persist }: AccountsSectionProps) {
  // 四级筛选条件：分组 -> 项目 -> 环境 -> 关键字，逐级联动收窄账号列表。
  const [selectedAccountGroupCode, setSelectedAccountGroupCode] = useState('');
  const [selectedAccountProjectId, setSelectedAccountProjectId] = useState('');
  const [selectedAccountEnvId, setSelectedAccountEnvId] = useState('');
  const [accountKeyword, setAccountKeyword] = useState('');
  // 账号新增/编辑弹窗状态：account 为空表示新增，projectId/envId 标记其归属上下文。
  const [accountModal, setAccountModal] = useState<{
    open: boolean;
    projectId: string;
    envId: string;
    account?: AccountRecord | null;
  }>({ open: false, projectId: '', envId: '', account: null });
  // 批量添加弹窗开关。
  const [batchModalOpen, setBatchModalOpen] = useState(false);

  const projectGroups = config.projectGroups ?? [];

  // 把分组 code 解析为分组名用于表格展示；缺省时退回默认分组，找不到则原样回显 code。
  function getGroupName(code: string | undefined): string {
    const resolved = code || DEFAULT_PROJECT_GROUP_CODE;
    return projectGroups.find((group) => group.code === resolved)?.name ?? resolved;
  }

  const selectedAccountProject = useMemo(
    () => config.projects.find((item) => item.id === selectedAccountProjectId) ?? null,
    [config, selectedAccountProjectId],
  );

  // 配置变更后若已选项目被删除，清空项目/环境筛选，避免引用失效 id。
  useEffect(() => {
    if (selectedAccountProjectId && !config.projects.some((p) => p.id === selectedAccountProjectId)) {
      setSelectedAccountProjectId('');
      setSelectedAccountEnvId('');
    }
  }, [config, selectedAccountProjectId]);

  // 已选环境若在当前项目中不再存在（如项目切换/环境删除），清空环境筛选。
  useEffect(() => {
    if (!selectedAccountProjectId || !selectedAccountProject || !selectedAccountEnvId) return;
    if (!selectedAccountProject.envs.some((item) => item.id === selectedAccountEnvId)) {
      setSelectedAccountEnvId('');
    }
  }, [selectedAccountEnvId, selectedAccountProject, selectedAccountProjectId]);

  // 将多层嵌套的「项目 -> 环境 -> 账号」按当前筛选条件展开为扁平表格行。
  const accountRows = useMemo(() => {
    const rows: Array<{ project: ProjectConfig; env: EnvConfig; account: AccountRecord }> = [];
    for (const project of config.projects) {
      // 分组筛选：项目无 groupCode 时视为默认分组。
      if (selectedAccountGroupCode && (project.groupCode ?? DEFAULT_PROJECT_GROUP_CODE) !== selectedAccountGroupCode) continue;
      if (selectedAccountProjectId && project.id !== selectedAccountProjectId) continue;
      for (const env of project.envs) {
        if (selectedAccountEnvId && env.id !== selectedAccountEnvId) continue;
        for (const account of env.accounts) {
          const keyword = accountKeyword.trim().toLowerCase();
          if (keyword) {
            // 关键字仅匹配非敏感字段拼成的可搜索文本，避免明文检索密码等敏感值。
            const preview = accountSearchText(project, account).toLowerCase();
            if (!preview.includes(keyword)) continue;
          }
          rows.push({ project, env, account });
        }
      }
    }
    return rows;
  }, [accountKeyword, config, selectedAccountEnvId, selectedAccountGroupCode, selectedAccountProjectId]);

  async function saveAccountDraft(record: AccountRecord) {
    if (!accountModal.projectId || !accountModal.envId) return;
    const next = saveAccount(config, accountModal.projectId, accountModal.envId, record);
    await persist(next, '账号已保存');
    setAccountModal({ open: false, projectId: '', envId: '', account: null });
  }

  async function deleteAccountItem(projectId: string, envId: string, accountId: string) {
    if (!confirm(`确认删除账号 ${accountId} ?`)) return;
    await persist(removeAccount(config, projectId, envId, accountId), '账号已删除');
  }

  // 设为默认账号；saveAccount 会负责清除同环境下其他账号的默认标记。
  async function setDefaultAccountItem(projectId: string, envId: string, accountId: string) {
    const project = config.projects.find((item) => item.id === projectId);
    const env = project?.envs.find((item) => item.id === envId);
    const account = env?.accounts.find((item) => item.id === accountId);
    if (!project || !env || !account) return;
    await persist(
      saveAccount(config, projectId, envId, {
        ...account,
        isDefault: true,
        updatedAt: new Date().toISOString(),
      }),
      '默认账号已更新',
    );
  }

  // 批量添加：逐行写入指定环境（saveAccount 保持不可变与「同环境唯一默认」语义），
  // 全部写入同一份新配置后一次性落盘，避免每条记录都触发持久化。
  async function batchSaveAccounts(projectId: string, envId: string, records: AccountRecord[]) {
    let next = config;
    for (const record of records) {
      next = saveAccount(next, projectId, envId, record);
    }
    await persist(next, `已添加 ${records.length} 个账号`);
    setBatchModalOpen(false);
  }

  return (
    <>
      <div className="wm-sections">
        <div className="wm-card">
          <div className="wm-card__hd">
            <strong>筛选</strong>
            <div className="wm-inline">
              <button
                className="wm-btn"
                type="button"
                onClick={() => {
                  setSelectedAccountGroupCode('');
                  setSelectedAccountProjectId('');
                  setSelectedAccountEnvId('');
                  setAccountKeyword('');
                }}
              >
                重置
              </button>
              <button
                className="wm-btn wm-btn--primary"
                type="button"
                onClick={() => {
                  // 新增账号默认落在当前筛选的项目/环境上下文；未选则退回首个项目及其首个环境。
                  const projectId = selectedAccountProjectId || config.projects[0]?.id || '';
                  const project = config.projects.find((item) => item.id === projectId);
                  const envId = selectedAccountEnvId || project?.envs[0]?.id || '';
                  setAccountModal({ open: true, projectId, envId, account: null });
                }}
              >
                <Plus size={14} /> 新增账号
              </button>
              <button className="wm-btn" type="button" onClick={() => setBatchModalOpen(true)}>
                <Plus size={14} /> 批量添加
              </button>
            </div>
          </div>
          <div className="wm-card__bd">
            <div className="wm-grid wm-grid--4">
              <label className="wm-field">
                <span>项目分组</span>
                <select
                  value={selectedAccountGroupCode}
                  onChange={(event) => {
                    setSelectedAccountGroupCode(event.target.value);
                    setSelectedAccountProjectId('');
                    setSelectedAccountEnvId('');
                  }}
                >
                  <option value="">全部</option>
                  {projectGroups.map((group) => (
                    <option key={group.code} value={group.code}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wm-field">
                <span>项目</span>
                <select
                  value={selectedAccountProjectId}
                  onChange={(event) => {
                    setSelectedAccountProjectId(event.target.value);
                    setSelectedAccountEnvId('');
                  }}
                >
                  <option value="">全部</option>
                  {/* 项目下拉随分组联动：仅列出当前分组下的项目（未选分组则全部）。 */}
                  {config.projects
                    .filter(
                      (project) =>
                        !selectedAccountGroupCode ||
                        (project.groupCode ?? DEFAULT_PROJECT_GROUP_CODE) === selectedAccountGroupCode,
                    )
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="wm-field">
                <span>环境</span>
                {/* 环境下拉依赖已选项目；未选项目时禁用并强制空值。 */}
                <select
                  value={selectedAccountProjectId ? selectedAccountEnvId : ''}
                  disabled={!selectedAccountProjectId}
                  onChange={(event) => setSelectedAccountEnvId(event.target.value)}
                >
                  <option value="">全部</option>
                  {(selectedAccountProject?.envs ?? []).map((env) => (
                    <option key={`${selectedAccountProjectId}-${env.id}-${env.name}`} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wm-field">
                <span>关键字</span>
                <input value={accountKeyword} onChange={(event) => setAccountKeyword(event.target.value)} />
              </label>
            </div>
          </div>
        </div>

        <div className="wm-card">
          <div className="wm-card__hd">
            <strong>账号列表</strong>
            <span className="wm-tiny">查询非敏感字段值</span>
          </div>
          <div className="wm-card__bd">
            {accountRows.length > 0 ? (
              <table className="wm-table">
                <thead>
                  <tr>
                    <th>项目分组</th>
                    <th>项目</th>
                    <th>环境</th>
                    <th>账号信息</th>
                    <th>默认</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {accountRows.map(({ project, env, account }) => (
                    <tr key={`${project.id}-${env.id}-${account.id}`}>
                      <td>{getGroupName(project.groupCode)}</td>
                      <td>{project.name}</td>
                      <td>{env.name}</td>
                      <td>
                        <span className="wm-code wm-cell__text">{accountInfoText(project, account)}</span>
                      </td>
                      <td>{account.isDefault ? '是' : ''}</td>
                      <td>
                        <div className="wm-table__actions">
                          <button
                            className="wm-btn"
                            type="button"
                            onClick={() => setAccountModal({ open: true, projectId: project.id, envId: env.id, account })}
                          >
                            <Pencil size={13} /> 编辑
                          </button>
                          <button className="wm-btn" type="button" onClick={() => void setDefaultAccountItem(project.id, env.id, account.id)}>
                            <Star size={13} /> 默认
                          </button>
                          <button className="wm-btn wm-btn--danger" type="button" onClick={() => void deleteAccountItem(project.id, env.id, account.id)}>
                            <Trash2 size={13} /> 删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="wm-tiny">没有匹配账号。</div>
            )}
          </div>
        </div>
      </div>

      {/* 账号编辑弹窗：配置管理页允许切换项目/环境（不锁定上下文），与登录页固定上下文不同。 */}
      <AccountEditorModal
        open={accountModal.open}
        project={accountModal.projectId ? config.projects.find((item) => item.id === accountModal.projectId) ?? null : null}
        projects={config.projects}
        projectId={accountModal.projectId}
        envId={accountModal.envId}
        account={accountModal.account}
        title={accountModal.account ? '编辑账号' : '新增账号'}
        onClose={() => setAccountModal({ open: false, projectId: '', envId: '', account: null })}
        onProjectChange={(nextProjectId) => {
          const nextProject = config.projects.find((item) => item.id === nextProjectId);
          setAccountModal((prev) => ({
            ...prev,
            projectId: nextProjectId,
            envId: nextProject?.envs[0]?.id ?? '',
          }));
        }}
        onEnvChange={(nextEnvId) => {
          setAccountModal((prev) => ({
            ...prev,
            envId: nextEnvId,
          }));
        }}
        onSave={(record) => void saveAccountDraft(record)}
      />

      {/* 批量添加弹窗：默认落在当前筛选的项目/环境上下文，未选则退回首个项目及其首个环境。 */}
      <BatchAddAccountsModal
        open={batchModalOpen}
        config={config}
        projectId={selectedAccountProjectId || config.projects[0]?.id || ''}
        envId={selectedAccountEnvId || selectedAccountProject?.envs[0]?.id || ''}
        onClose={() => setBatchModalOpen(false)}
        onSave={(projectId, envId, records) => void batchSaveAccounts(projectId, envId, records)}
      />
    </>
  );
}
