// 配置管理页的弹窗组件集合：通用弹窗外壳 ModalShell，以及项目编辑、字段编辑、
// 环境编辑、导出配置等各类弹窗。各弹窗以本地草稿（draft）方式编辑，仅在保存时回调上抛。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Copy, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { DEFAULT_POPUP_POSITION, POPUP_POSITION_OPTIONS } from '../shared/popup-position';
import { createId } from '../shared/id';
import type { EnvConfig, FieldConfig, FieldTemplate, ProjectConfig, ProjectGroup, SyncConfig } from '../shared/types';

// 用于为每个弹窗生成唯一的 title id（aria-labelledby），保证无障碍标注互不冲突。
let modalIdCounter = 0;

// 环境编辑的草稿类型：在 EnvConfig 基础上额外保存几个「文本态」字段，
// 让 hosts/pathKeywords/retryDelays 这类数组能以逗号分隔字符串的形式直接编辑，
// 保存时再解析回数组（见 parseListText / parseRetryText）。
type EnvDraft = EnvConfig & {
  hostsText: string;
  pathKeywordsText: string;
  retryDelaysText: string;
};

type ModalProps = {
  open: boolean;
  title: string;
  width?: number;
  mode?: 'modal' | 'drawer';
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * 通用弹窗外壳：提供遮罩、标题栏、关闭按钮、可选底部操作区，并处理无障碍与键盘交互。
 * 支持 modal（居中）与 drawer（抽屉）两种展示模式。内容与底部按钮由调用方传入。
 */
function ModalShell({ open, title, width = 900, mode = 'modal', onClose, children, footer }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // 记录弹窗打开前的焦点元素（触发者），关闭时把焦点归还回去。
  const triggerRef = useRef<HTMLElement | null>(null);
  const [titleId] = useState(() => `wm-modal-title-${++modalIdCounter}`);
  // 用 ref 持有最新的 onClose：其闭包随父组件渲染变化，若直接进入 effect 依赖，
  // 会导致键盘监听器反复重装，连带把焦点记录与自动聚焦逻辑打乱。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 焦点陷阱：Tab/Shift+Tab 在弹窗内部循环，避免焦点跑到弹窗外的页面元素上。
  const trapFocus = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey) {
      // Shift+Tab 在第一个可聚焦元素上时，回卷到最后一个。
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      // Tab 在最后一个可聚焦元素上时，循环回到第一个。
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // 记录触发弹窗时的焦点元素，便于卸载时归还。
    triggerRef.current = document.activeElement as HTMLElement;
    // 延迟到下一轮事件循环再聚焦，确保弹窗 DOM 已挂载。
    const timer = setTimeout(() => {
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    }, 0);
    // 键盘交互：Escape 关闭弹窗；Tab/Shift+Tab 在弹窗内循环（焦点陷阱）。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      trapFocus(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      // 弹窗关闭/卸载时把焦点还给打开它的元素。
      triggerRef.current?.focus();
    };
  }, [open, trapFocus]);

  if (!open) return null;
  return (
    <div className={`wm-overlay ${mode === 'drawer' ? 'wm-overlay--drawer' : ''}`} role="presentation">
      <div
        ref={dialogRef}
        className={`wm-modal ${mode === 'drawer' ? 'wm-drawer' : ''}`}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="wm-modal__header">
          <strong id={titleId}>{title}</strong>
          <button className="wm-icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="wm-modal__body">{children}</div>
        {footer ? <div className="wm-modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

// 通过 JSON 序列化做深拷贝，确保草稿与原配置完全隔离，编辑过程不污染源对象。
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

// 将数组中下标 from 的元素移动到下标 to（用于字段拖动排序），返回新数组不改原数组。
function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

// 以下四个辅助函数负责「数组 <-> 逗号分隔文本」互转，配合 EnvDraft 的文本态字段使用。
function toRetryText(delays: number[]): string {
  return delays.join(', ');
}

function toListText(values: string[]): string {
  return values.join(', ');
}

// 解析逗号分隔文本为字符串数组：去首尾空格并过滤空项。
function parseListText(text: string): string[] {
  return text
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

// 解析逗号分隔文本为数字数组：转数字并过滤掉非有限值（如空串/非数字）。
function parseRetryText(text: string): number[] {
  return text
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

/**
 * 项目基础信息编辑弹窗：编辑项目 ID、名称、所属分组、登录页弹窗位置等。
 * 选择「字段配置模板」会用模板字段覆盖草稿的 fields。
 * project 为 null 时不展示；保存时通过 onSave 上抛完整 ProjectConfig。
 */
export function ProjectEditorModal({
  open,
  project,
  groups,
  fieldTemplates,
  title,
  mode = 'modal',
  onClose,
  onSave,
}: {
  open: boolean;
  project: ProjectConfig | null;
  groups: ProjectGroup[];
  fieldTemplates: FieldTemplate[];
  title: string;
  mode?: 'modal' | 'drawer';
  onClose: () => void;
  onSave: (next: ProjectConfig) => void;
}) {
  const [draft, setDraft] = useState<ProjectConfig | null>(project);
  // 当前选中的字段模板 id；空串表示不套用模板。
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // 每次打开时用传入的 project 重新初始化草稿（深拷贝隔离），并清空模板选择。
  useEffect(() => {
    if (!open || !project) return;
    setDraft(clone(project));
    setSelectedTemplateId('');
  }, [open, project]);

  // 校验：项目 ID 与名称均非空白才允许保存。
  const canSave = Boolean(draft?.id.trim() && draft?.name.trim());

  return (
    <ModalShell
      open={open && Boolean(draft)}
      title={title}
      width={640}
      mode={mode}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="wm-btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="wm-btn wm-btn--primary"
            disabled={!canSave}
            onClick={() => {
              if (!draft) return;
              // 兜底保证 fields/envs 为数组，避免上层拿到 undefined。
              onSave({ ...draft, fields: draft.fields ?? [], envs: draft.envs ?? [] });
            }}
          >
            保存
          </button>
        </>
      }
    >
      {draft ? (
        <div className="wm-grid wm-grid--2">
          <label className="wm-field">
            <span>项目 ID *</span>
            <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} />
          </label>
          <label className="wm-field">
            <span>项目名称 *</span>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="wm-field">
            <span>项目分组</span>
            <select value={draft.groupCode ?? 'default'} onChange={(event) => setDraft({ ...draft, groupCode: event.target.value })}>
              {groups.map((group) => (
                <option key={group.code} value={group.code}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wm-field">
            <span>字段配置模板</span>
            <select
              value={selectedTemplateId}
              onChange={(event) => {
                const templateId = event.target.value;
                setSelectedTemplateId(templateId);
                // 选中模板后，直接用模板字段（深拷贝）覆盖当前草稿的 fields。
                const template = fieldTemplates.find((item) => item.id === templateId);
                if (template) {
                  setDraft({ ...draft, fields: clone(template.fields) });
                }
              }}
            >
              <option value="">不使用模板</option>
              {fieldTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label className="wm-field">
            <span>登录页弹窗位置</span>
            <select
              value={draft.popupPosition ?? DEFAULT_POPUP_POSITION}
              onChange={(event) => setDraft({ ...draft, popupPosition: event.target.value as ProjectConfig['popupPosition'] })}
            >
              {POPUP_POSITION_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </ModalShell>
  );
}

/**
 * 项目字段配置弹窗：以表格形式增删改字段并支持拖动排序。
 * 每行可编辑 key/名称/类型（input 或 display）/选择器/敏感/必填/宽度等；
 * display 类型不填充页面，故清空并禁用选择器输入。
 * showCopyable 控制是否展示「复制」列（默认展示）。保存时通过 onSave 上抛字段数组。
 */
export function ProjectFieldsModal({
  open,
  project,
  title,
  showCopyable = true,
  onClose,
  onSave,
}: {
  open: boolean;
  project: ProjectConfig | null;
  title: string;
  showCopyable?: boolean;
  onClose: () => void;
  onSave: (nextFields: FieldConfig[]) => void;
}) {
  const [draft, setDraft] = useState<FieldConfig[]>([]);
  // 拖动排序时记录被拖起行的下标；拖放完成后置回 null。
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // 打开时用项目现有字段初始化草稿（深拷贝隔离）。
  useEffect(() => {
    if (!open || !project) return;
    setDraft(clone(project.fields));
  }, [open, project]);

  const fieldCount = useMemo(() => draft.length, [draft]);

  return (
    <ModalShell
      open={open && Boolean(project)}
      title={title}
      width={1180}
      onClose={onClose}
      footer={
        <>
          <span className="wm-tiny">共 {fieldCount} 个字段</span>
          <div className="wm-inline">
            <button type="button" className="wm-btn" onClick={onClose}>
              取消
            </button>
            <button type="button" className="wm-btn wm-btn--primary" onClick={() => onSave(clone(draft))}>
              保存
            </button>
          </div>
        </>
      }
    >
      <div className="wm-inline" style={{ justifyContent: 'space-between' }}>
        <div className="wm-tiny">字段配置支持增删改查和拖动排序。带 * 的字段为必填；input 类型还需要配置选择器。</div>
        <button
          type="button"
          className="wm-btn wm-btn--primary"
          onClick={() =>
            setDraft((prev) => [
              ...prev,
              {
                // 用时间戳生成默认唯一 key，避免与既有字段冲突。
                key: `field_${Date.now()}`,
                label: '新字段',
                type: 'input',
                selector: '',
                sensitive: false,
                required: false,
                copyable: true,
                minWidth: 120,
                maxWidth: 220,
              },
            ])
          }
        >
          <Plus size={14} /> 新增字段
        </button>
      </div>
      <table className="wm-table">
        <thead>
          <tr>
            <th>顺序</th>
            <th>Key *</th>
            <th>名称 *</th>
            <th>类型 *</th>
            <th>选择器</th>
            <th>敏感</th>
            <th>必填</th>
            {showCopyable ? <th>复制</th> : null}
            <th>宽度</th>
            <th>最小/最大</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {draft.map((field, index) => (
            <tr
              key={index}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                // 拖放到自身或无拖起行时忽略；否则把拖起行移动到当前行位置。
                if (dragIndex === null || dragIndex === index) return;
                setDraft((prev) => moveItem(prev, dragIndex, index));
                setDragIndex(null);
              }}
              onDragEnd={() => setDragIndex(null)}
            >
              <td>
                <button type="button" className="wm-icon-btn" title="拖动排序" onDragStart={() => setDragIndex(index)}>
                  <GripVertical size={14} />
                </button>
              </td>
              <td>
                <input
                  value={field.key}
                  onChange={(event) => setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, key: event.target.value } : item)))}
                />
              </td>
              <td>
                <input
                  value={field.label}
                  onChange={(event) => setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)))}
                />
              </td>
              <td>
                <select
                  value={field.type}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev.map((item, i) => {
                        if (i !== index) return item;
                        const type = event.target.value as FieldConfig['type'];
                        // 切换为 display（仅展示）时清空选择器，因为该类型不填充页面。
                        return type === 'display' ? { ...item, type, selector: '' } : { ...item, type };
                      }),
                    )
                  }
                >
                  <option value="input">input</option>
                  <option value="display">display</option>
                </select>
              </td>
              <td>
                <input
                  value={field.selector ?? ''}
                  disabled={field.type === 'display'}
                  placeholder={field.type === 'display' ? '展示字段不填充页面' : 'CSS selector'}
                  onChange={(event) =>
                    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, selector: event.target.value } : item)))
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={field.sensitive}
                  onChange={(event) =>
                    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, sensitive: event.target.checked } : item)))
                  }
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={Boolean(field.required)}
                  onChange={(event) =>
                    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, required: event.target.checked } : item)))
                  }
                />
              </td>
              {showCopyable ? (
                <td>
                  <input
                    type="checkbox"
                    checked={field.copyable !== false}
                    onChange={(event) =>
                      setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, copyable: event.target.checked } : item)))
                    }
                  />
                </td>
              ) : null}
              <td>
                <input
                  value={String(field.width ?? '')}
                  onChange={(event) => setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, width: event.target.value } : item)))}
                />
              </td>
              <td className="wm-inline" style={{ flexWrap: 'nowrap' }}>
                <input
                  style={{ width: 80 }}
                  value={String(field.minWidth ?? '')}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, minWidth: Number(event.target.value || 0) || undefined } : item)),
                    )
                  }
                />
                <input
                  style={{ width: 80 }}
                  value={String(field.maxWidth ?? '')}
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, maxWidth: Number(event.target.value || 0) || undefined } : item)),
                    )
                  }
                />
              </td>
              <td className="wm-actions-col">
                <button className="wm-btn wm-btn--danger" type="button" onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}>
                  <Trash2 size={13} /> 删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ModalShell>
  );
}

/**
 * 项目环境配置弹窗：以卡片形式增删改环境。每个环境含 ID、名称、Hosts、Path 关键字、重试延迟。
 * 编辑期间 hosts/pathKeywords/retryDelays 以逗号分隔文本（*Text 字段）呈现，
 * 保存时再解析回数组结构（见 onSave 中的映射），accounts 原样保留。
 */
export function ProjectEnvsModal({
  open,
  project,
  title,
  onClose,
  onSave,
}: {
  open: boolean;
  project: ProjectConfig | null;
  title: string;
  onClose: () => void;
  onSave: (nextEnvs: EnvConfig[]) => void;
}) {
  const [draft, setDraft] = useState<EnvDraft[]>([]);
  // 折叠状态：按环境 id 记录各卡片是否收起。用 env.id 而非数组下标做键——
  // 删除中间的环境后下标会前移，按下标记录会导致折叠状态错位。
  // 纯 UI 状态，不落入草稿数据（保存时只映射 EnvConfig 字段）。
  const [collapsedEnvs, setCollapsedEnvs] = useState<Record<string, boolean>>({});

  // 打开时将环境数组转为草稿：把数组型字段拍平成逗号分隔文本，便于直接编辑。
  useEffect(() => {
    if (!open || !project) return;
    setDraft(
      clone(project.envs).map((env) => ({
        ...env,
        hostsText: toListText(env.hosts),
        pathKeywordsText: toListText(env.pathKeywords),
        retryDelaysText: toRetryText(env.retryDelays),
      })),
    );
  }, [open, project]);

  // 复制环境：连同账号整体克隆到草稿末尾。环境与账号 id 全部重建——id 是合并
  // 引擎的稳定标识，复制品必须全新；账号 values 与默认标记、hosts/路径/重试配置
  // 原样保留。名称追加「副本」后缀，重名时递增数字。新副本默认展开（无折叠记录）。
  function copyEnv(envId: string) {
    const source = draft.find((item) => item.id === envId);
    if (!source) return;
    const existingNames = new Set(draft.map((item) => item.name));
    let name = `${source.name} 副本`;
    let seq = 2;
    while (existingNames.has(name)) {
      name = `${source.name} 副本${seq}`;
      seq += 1;
    }
    const copy: EnvDraft = {
      ...clone(source),
      id: createId('env'),
      name,
      accounts: (source.accounts ?? []).map((account) => ({ ...clone(account), id: createId('account') })),
    };
    setDraft((prev) => [...prev, copy]);
  }

  return (
    <ModalShell
      open={open && Boolean(project)}
      title={title}
      width={1180}
      onClose={onClose}
      footer={
        <>
          <span className="wm-tiny">共 {draft.length} 个环境</span>
          <div className="wm-inline">
            <button type="button" className="wm-btn" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="wm-btn wm-btn--primary"
              onClick={() =>
                onSave(
                  // 保存时把文本态字段解析回数组，只回传 EnvConfig 结构（剔除 *Text 草稿字段）。
                  clone(draft).map((env) => ({
                    id: env.id,
                    name: env.name,
                    hosts: parseListText(env.hostsText),
                    pathKeywords: parseListText(env.pathKeywordsText),
                    retryDelays: parseRetryText(env.retryDelaysText),
                    accounts: env.accounts,
                  })),
                )
              }
            >
              保存
            </button>
          </div>
        </>
      }
    >
      <div className="wm-inline" style={{ justifyContent: 'space-between' }}>
        <div className="wm-tiny">
          环境配置支持增删改查。带 * 的字段为必填。Hosts 和 Path 关键字使用英文逗号分隔；重试延迟示例：0, 500, 1000。
        </div>
        <button
          type="button"
          className="wm-btn wm-btn--primary"
          onClick={() =>
            setDraft((prev) => [
              ...prev,
              {
                // 新增环境时用时间戳生成默认 ID，并同步初始化数组字段与其文本态。
                id: `env_${Date.now()}`,
                name: '新环境',
                hosts: ['example.com'],
                hostsText: 'example.com',
                pathKeywords: ['/login'],
                pathKeywordsText: '/login',
                retryDelays: [0, 500],
                accounts: [],
                retryDelaysText: '0, 500',
              },
            ])
          }
        >
          <Plus size={14} /> 新增环境
        </button>
      </div>
      <div className="wm-grid">
        {draft.map((env, index) => (
          <div className="wm-card" key={index}>
            <div className="wm-card__hd">
              <strong>{env.name || env.id}</strong>
              <div className="wm-inline">
                <button
                  className="wm-btn"
                  type="button"
                  aria-label={`复制环境 ${env.name || env.id}`}
                  title={`复制环境 ${env.name || env.id}`}
                  onClick={() => copyEnv(env.id)}
                >
                  <Copy size={13} />
                </button>
                <button
                  className="wm-btn"
                  type="button"
                  aria-expanded={!collapsedEnvs[env.id]}
                  aria-label={collapsedEnvs[env.id] ? `展开环境 ${env.name || env.id}` : `收起环境 ${env.name || env.id}`}
                  onClick={() => setCollapsedEnvs((prev) => ({ ...prev, [env.id]: !prev[env.id] }))}
                >
                  {collapsedEnvs[env.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>
                <button className="wm-btn wm-btn--danger" type="button" onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}>
                  <Trash2 size={13} /> 删除
                </button>
              </div>
            </div>
            {collapsedEnvs[env.id] ? null : (
              <div className="wm-card__bd">
                <div className="wm-grid wm-grid--2">
                  <label className="wm-field">
                    <span>环境 ID *</span>
                    <input
                      value={env.id}
                      onChange={(event) => setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, id: event.target.value } : item)))}
                    />
                  </label>
                  <label className="wm-field">
                    <span>环境名称 *</span>
                    <input
                      value={env.name}
                      onChange={(event) => setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))}
                    />
                  </label>
                  <label className="wm-field">
                    <span>Hosts *</span>
                    <small>英文逗号分隔，例如 10.0.0.1, login.example.com；填主机名即可，不带协议和路径；带非标准端口时可写 app.com:8080 按端口区分环境</small>
                    <input
                      value={env.hostsText}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  hostsText: event.target.value,
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="wm-field">
                    <span>Path 关键字 *</span>
                    <small>英文逗号分隔，例如 /login, /admin；留空则匹配该主机下所有页面路径</small>
                    <input
                      value={env.pathKeywordsText}
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  pathKeywordsText: event.target.value,
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="wm-field">
                    <span>重试延迟 *</span>
                    <small>英文逗号分隔，单位毫秒，例如 0, 500, 1000</small>
                    <input
                      value={env.retryDelaysText}
                      placeholder="0, 500, 1000"
                      onChange={(event) =>
                        setDraft((prev) =>
                          prev.map((item, i) => (i === index ? { ...item, retryDelaysText: event.target.value } : item)),
                        )
                      }
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

/**
 * 导出配置弹窗：勾选要导出的项目，并决定是否一并导出 MinIO 同步配置与主题设置。
 * 仅当当前存在 MinIO 相关配置时才显示「导出 MinIO 配置」选项。
 * 选项通过 onExport 上抛（projectIds / includeMinio / includeAppearance）。
 */
export function ExportConfigModal({
  open,
  config,
  onClose,
  onExport,
}: {
  open: boolean;
  config: { projects: Array<{ id: string; name: string }>; sync: SyncConfig };
  onClose: () => void;
  onExport: (options: { projectIds: string[]; includeMinio: boolean; includeAppearance: boolean }) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [includeMinio, setIncludeMinio] = useState(false);
  const [includeAppearance, setIncludeAppearance] = useState(true);

  // 打开时初始化：默认全选所有项目；当已配置任一 MinIO 相关项时默认勾选导出 MinIO；主题默认导出。
  useEffect(() => {
    if (!open) return;
    const ids = config.projects.map((item) => item.id);
    setSelected(ids);
    setIncludeMinio(Boolean(config.sync.minioEnabled || config.sync.endpoint || config.sync.bucket || config.sync.accessKey || config.sync.secretKey));
    setIncludeAppearance(true);
  }, [config, open]);

  // 是否存在 MinIO 配置（任一关键字段有值即视为存在），用于决定是否展示对应导出选项。
  const hasMinio = Boolean(config.sync.minioEnabled || config.sync.endpoint || config.sync.bucket || config.sync.accessKey || config.sync.secretKey);

  return (
    <ModalShell
      open={open}
      title="导出配置"
      width={720}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="wm-btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="wm-btn wm-btn--primary" onClick={() => onExport({ projectIds: selected, includeMinio, includeAppearance })}>
            导出
          </button>
        </>
      }
    >
      <div className="wm-tiny">默认全选项目，可按需取消项目，并决定是否导出 MinIO 配置。</div>
      <div className="wm-grid">
        <div className="wm-inline">
          <button type="button" className="wm-btn" onClick={() => setSelected(config.projects.map((item) => item.id))}>
            全选
          </button>
          <button type="button" className="wm-btn" onClick={() => setSelected([])}>
            全不选
          </button>
        </div>
        {config.projects.map((project) => (
          <label key={project.id} className="wm-inline">
            <input
              type="checkbox"
              checked={selected.includes(project.id)}
              onChange={(event) =>
                setSelected((prev) =>
                  event.target.checked ? [...prev, project.id] : prev.filter((item) => item !== project.id),
                )
              }
            />
            {project.name} <span className="wm-tiny">{project.id}</span>
          </label>
        ))}
        {hasMinio ? (
          <label className="wm-inline">
            <input type="checkbox" checked={includeMinio} onChange={(event) => setIncludeMinio(event.target.checked)} />
            导出 MinIO 配置
          </label>
        ) : null}
        <label className="wm-inline">
          <input type="checkbox" checked={includeAppearance} onChange={(event) => setIncludeAppearance(event.target.checked)} />
          导出主题设置
        </label>
      </div>
    </ModalShell>
  );
}
