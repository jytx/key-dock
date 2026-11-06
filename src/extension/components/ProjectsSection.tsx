// 项目管理分区：按分组/名称筛选项目列表，并提供项目、字段、环境的新增/编辑/删除入口。
import { useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_PROJECT_GROUP_CODE } from '../../shared/defaults';
import { duplicateProject, saveProject, removeProject } from '../../shared/config-ops';
import { shouldUseProjectDrawer } from '../../shared/theme';
import { createBlankProject, syncAccountsWithFields, replaceProject, type ToastVariant } from '../helpers';
import { ProjectEditorModal, ProjectFieldsModal, ProjectEnvsModal } from '../modals';
import type { AppConfig, EnvConfig, FieldConfig, ProjectConfig } from '../../shared/types';

type ProjectsSectionProps = {
  config: AppConfig;
  persist: (next: AppConfig, status?: string) => Promise<void>;
  showToast: (target: HTMLElement, message: string, variant?: ToastVariant) => void;
};

/** 项目管理分区组件。弹窗在抽屉/居中两种形态间按外观设置切换。 */
export function ProjectsSection({ config, persist }: ProjectsSectionProps) {
  const [selectedProjectGroupCode, setSelectedProjectGroupCode] = useState('');
  const [projectKeyword, setProjectKeyword] = useState('');
  const [projectModal, setProjectModal] = useState<{
    open: boolean;
    originalId: string | null;
    project: ProjectConfig | null;
  }>({ open: false, originalId: null, project: null });
  const [fieldModalProjectId, setFieldModalProjectId] = useState<string | null>(null);
  const [envModalProjectId, setEnvModalProjectId] = useState<string | null>(null);

  const projectGroups = config.projectGroups ?? [];
  const fieldTemplates = config.fieldTemplates ?? [];

  // 按选中分组 + 名称关键字过滤项目；未设置分组的项目按默认分组处理，关键字大小写不敏感。
  const filteredProjects = useMemo(() => {
    const keyword = projectKeyword.trim().toLowerCase();
    return config.projects.filter((project) => {
      if (selectedProjectGroupCode && (project.groupCode ?? DEFAULT_PROJECT_GROUP_CODE) !== selectedProjectGroupCode) return false;
      if (keyword && !project.name.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [config, projectKeyword, selectedProjectGroupCode]);

  // 由分组 code 解析展示名；空 code 归默认分组，找不到分组定义时回退显示 code 本身。
  function getGroupName(code: string | undefined): string {
    const resolved = code || DEFAULT_PROJECT_GROUP_CODE;
    return projectGroups.find((group) => group.code === resolved)?.name ?? resolved;
  }

  /**
   * 新增或更新项目：originalId 为空表示新增、追加到列表末尾；非空表示编辑、替换原项目。
   * 保存前兜底分组 code 为默认值，并调用 syncAccountsWithFields 使账号字段与项目字段保持一致。
   */
  async function upsertProject(originalId: string | null, nextProject: ProjectConfig) {
    const normalized = syncAccountsWithFields({ ...nextProject, groupCode: nextProject.groupCode || DEFAULT_PROJECT_GROUP_CODE });
    const nextConfig = originalId ? replaceProject(config, originalId, normalized) : { ...config, projects: [...config.projects, normalized] };
    await persist(nextConfig, originalId ? '项目已保存' : '项目已新增');
    setProjectModal({ open: false, originalId: null, project: null });
  }

  // 删除项目：先二次确认再落盘。
  async function deleteProject(projectId: string) {
    const project = config.projects.find((item) => item.id === projectId);
    if (!project) return;
    if (!confirm(`确认删除项目 ${project.name} ?`)) return;
    await persist(removeProject(config, projectId), '项目已删除');
  }

  // 复制项目：整套字段/环境/账号克隆，id 全部重建，名称自动加「副本」后缀；非破坏操作无需确认。
  async function copyProject(projectId: string) {
    const project = config.projects.find((item) => item.id === projectId);
    if (!project) return;
    await persist(duplicateProject(config, projectId), `已复制项目 ${project.name}`);
  }

  // 保存字段配置：字段变更后同步账号 values，剔除废弃字段并补齐新增字段。
  async function saveProjectFields(projectId: string, nextFields: FieldConfig[]) {
    const project = config.projects.find((item) => item.id === projectId);
    if (!project) return;
    const nextProject = syncAccountsWithFields({ ...project, fields: nextFields });
    await persist(saveProject(config, nextProject), '字段已保存');
    setFieldModalProjectId(null);
  }

  // 保存环境配置：仅替换 envs，账号字段结构不受影响，无需重新规整。
  async function saveProjectEnvs(projectId: string, nextEnvs: EnvConfig[]) {
    const project = config.projects.find((item) => item.id === projectId);
    if (!project) return;
    await persist(saveProject(config, { ...project, envs: nextEnvs }), '环境已保存');
    setEnvModalProjectId(null);
  }

  return (
    <>
      <div className="wm-sections">
        <div className="wm-card">
          <div className="wm-card__hd">
            <strong>筛选</strong>
            <button
              className="wm-btn"
              type="button"
              onClick={() => {
                setSelectedProjectGroupCode('');
                setProjectKeyword('');
              }}
            >
              重置
            </button>
          </div>
          <div className="wm-card__bd">
            <div className="wm-grid wm-grid--2">
              <label className="wm-field">
                <span>分组</span>
                <select value={selectedProjectGroupCode} onChange={(event) => setSelectedProjectGroupCode(event.target.value)}>
                  <option value="">全部</option>
                  {projectGroups.map((group) => (
                    <option key={group.code} value={group.code}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wm-field">
                <span>项目名称</span>
                <input value={projectKeyword} onChange={(event) => setProjectKeyword(event.target.value)} />
              </label>
            </div>
          </div>
        </div>
        <div className="wm-card">
          <div className="wm-card__hd">
            <strong>项目列表</strong>
            <button className="wm-btn wm-btn--primary" type="button" onClick={() => setProjectModal({ open: true, originalId: null, project: createBlankProject() })}>
              <Plus size={14} /> 新增项目
            </button>
          </div>
          <div className="wm-card__bd">
            {filteredProjects.length > 0 ? (
              <table className="wm-table">
                <thead>
                  <tr>
                    <th>分组</th>
                    <th>名称</th>
                    <th>字段</th>
                    <th>环境</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((project) => (
                    <tr key={project.id}>
                      <td>{getGroupName(project.groupCode)}</td>
                      <td>{project.name}</td>
                      <td>{project.fields.length}</td>
                      <td>{project.envs.length}</td>
                      <td>
                        <div className="wm-table__actions">
                          <button className="wm-btn" type="button" onClick={() => setProjectModal({ open: true, originalId: project.id, project })}>
                            <Pencil size={13} /> 编辑
                          </button>
                          <button className="wm-btn" type="button" onClick={() => void copyProject(project.id)}>
                            <Copy size={13} /> 复制
                          </button>
                          <button className="wm-btn" type="button" onClick={() => setFieldModalProjectId(project.id)}>
                            字段配置
                          </button>
                          <button className="wm-btn" type="button" onClick={() => setEnvModalProjectId(project.id)}>
                            环境配置
                          </button>
                          <button className="wm-btn wm-btn--danger" type="button" onClick={() => void deleteProject(project.id)}>
                            <Trash2 size={13} /> 删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="wm-tiny">当前没有项目。可通过"新增项目"或导入 JSON 创建配置。</div>
            )}
          </div>
        </div>
      </div>

      <ProjectEditorModal
        open={projectModal.open}
        project={projectModal.project}
        groups={projectGroups}
        fieldTemplates={fieldTemplates}
        title={projectModal.originalId ? '编辑项目' : '新增项目'}
        mode={shouldUseProjectDrawer(config.global.appearance) ? 'drawer' : 'modal'}
        onClose={() => setProjectModal({ open: false, originalId: null, project: null })}
        onSave={(next) => void upsertProject(projectModal.originalId, next)}
      />

      <ProjectFieldsModal
        open={Boolean(fieldModalProjectId)}
        project={fieldModalProjectId ? config.projects.find((item) => item.id === fieldModalProjectId) ?? null : null}
        title="字段配置"
        showCopyable={false}
        onClose={() => setFieldModalProjectId(null)}
        onSave={(nextFields) => {
          if (fieldModalProjectId) void saveProjectFields(fieldModalProjectId, nextFields);
        }}
      />

      <ProjectEnvsModal
        open={Boolean(envModalProjectId)}
        project={envModalProjectId ? config.projects.find((item) => item.id === envModalProjectId) ?? null : null}
        title="环境配置"
        onClose={() => setEnvModalProjectId(null)}
        onSave={(nextEnvs) => {
          if (envModalProjectId) void saveProjectEnvs(envModalProjectId, nextEnvs);
        }}
      />
    </>
  );
}
