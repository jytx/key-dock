// 通用账号新增/编辑弹窗，登录页与配置管理页共用。
// 负责按项目字段定义渲染表单、必填校验、敏感字段明文切换，以及（可选）项目/环境上下文选择。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Trash2, X } from 'lucide-react';
import { createAccountDraft } from './account-utils';
import { createId } from './id';
import type { AccountRecord, ProjectConfig } from './types';

// 递增计数器，为每个弹窗实例生成唯一 title id（用于 aria-labelledby）。
let accountModalIdCounter = 0;

type Props = {
  open: boolean;
  /** 当前账号所属项目；为 null 时弹窗不渲染。其 fields 定义决定表单字段。 */
  project: ProjectConfig | null;
  /** 可选项目列表；传入后渲染「项目」下拉，可在新增时切换上下文。不传则不显示项目/环境选择。 */
  projects?: ProjectConfig[];
  /** 受控的当前选中项目 id；缺省回退到 project.id。 */
  projectId?: string;
  /** 受控的当前选中环境 id；缺省回退到所选项目的首个环境。 */
  envId?: string;
  /** 待编辑账号；为空表示新增。 */
  account?: AccountRecord | null;
  title: string;
  /** 锁定上下文：为 true 时即便处于新增态也禁用项目/环境选择，强制固定为当前匹配到的项目/环境（登录页场景）。 */
  lockContext?: boolean;
  onClose: () => void;
  onSave: (record: AccountRecord) => void;
  onDelete?: (account: AccountRecord) => void;
  onProjectChange?: (projectId: string) => void;
  onEnvChange?: (envId: string) => void;
};

/**
 * 账号编辑弹窗。
 * 关键交互：
 * - 项目/环境选择仅在「新增 + 未锁定上下文 + 有可选项目」时可编辑（editableContext），
 *   编辑已有账号或锁定上下文时只读；
 * - 敏感字段（field.sensitive）默认以密码形式遮蔽，提供眼睛按钮逐字段切换明文（revealedFields）；
 * - 保存前对必填字段做校验。
 */
export function AccountEditorModal({
  open,
  project,
  projects,
  projectId,
  envId,
  account,
  title,
  lockContext,
  onClose,
  onSave,
  onDelete,
  onProjectChange,
  onEnvChange,
}: Props) {
  const initialDraft = useMemo(() => {
    if (!project) return null;
    return createAccountDraft(project, account ?? undefined);
  }, [account, project]);

  const [draft, setDraft] = useState<AccountRecord | null>(initialDraft);
  const [requiredErrors, setRequiredErrors] = useState<Record<string, boolean>>({});
  // 记录哪些敏感字段已切换为明文显示，key 为字段 key。
  const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  // 记录打开弹窗前的焦点元素，关闭时归还焦点（无障碍）。
  const triggerRef = useRef<HTMLElement | null>(null);
  // 用 ref 持有最新的 onClose：其闭包随父组件渲染变化，若直接进入 effect 依赖，
  // 会导致键盘监听器反复重装，连带把焦点记录与自动聚焦逻辑打乱。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const [titleId] = useState(() => `wm-account-modal-title-${++accountModalIdCounter}`);

  // 将 Tab 焦点限制在弹窗内循环，防止焦点逃逸到背景页面。
  const trapFocus = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !dialogRef.current) return;
    // 焦点位于 Shadow DOM 内时 document.activeElement 是 shadow host，
    // 需取 shadowRoot.activeElement 才是真实焦点元素（登录页浮窗场景）。
    const activeHost = document.activeElement as HTMLElement | null;
    const active = (activeHost?.shadowRoot?.activeElement as HTMLElement | null) ?? activeHost;
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey) {
      if (active === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }, []);

  // 每次打开或切换项目/账号时，按项目字段重建草稿并清空校验、明文显示状态。
  useEffect(() => {
    if (!open || !project) return;
    setDraft(createAccountDraft(project, account ?? undefined));
    setRequiredErrors({});
    setRevealedFields({});
  }, [account, open, project]);

  // 打开时聚焦首个可聚焦元素并装载焦点陷阱；关闭时还原焦点。
  useEffect(() => {
    if (!open) return;
    // 打开前焦点可能位于 Shadow DOM 内（登录页浮窗），记录真实焦点元素而非 shadow host。
    const activeHost = document.activeElement as HTMLElement | null;
    triggerRef.current = (activeHost?.shadowRoot?.activeElement as HTMLElement | null) ?? activeHost;
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
      triggerRef.current?.focus();
    };
  }, [open, trapFocus]);

  if (!open || !project || !draft) return null;
  const projectOptions = projects && projects.length > 0 ? projects : [project];
  const selectedProjectId = projectId ?? project.id;
  const selectedProject = projectOptions.find((item) => item.id === selectedProjectId) ?? project;
  const selectedEnvId = envId ?? selectedProject.envs[0]?.id ?? '';
  // 仅新增、未锁定上下文且存在可选项目时才允许改项目/环境；编辑或锁定态下置灰。
  const editableContext = !account && !lockContext && projectOptions.length > 0;

  function handleSave() {
    if (!project || !draft) return;
    // 收集所有必填且为空的字段，标红并阻断保存。
    const nextErrors = Object.fromEntries(
      project.fields
        .filter((field) => field.required && !String(draft.values[field.key] ?? '').trim())
        .map((field) => [field.key, true]),
    );
    setRequiredErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onSave({ ...draft, updatedAt: new Date().toISOString() });
  }

  return (
    <div className="wm-overlay" role="presentation">
      <div ref={dialogRef} className="wm-modal wm-account-editor-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="wm-modal__header">
          <strong id={titleId}>{title}</strong>
          <button className="wm-icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="wm-modal__body">
          {/* 仅当传入 projects 时渲染项目/环境选择；disabled 由 editableContext 控制（锁定/编辑态只读）。 */}
          {projects ? (
            <>
              <label className="wm-field wm-field--aligned">
                <span>项目</span>
                <div className="wm-field__control">
                  <select
                    value={selectedProjectId}
                    disabled={!editableContext}
                    onChange={(event) => {
                      const nextProjectId = event.target.value;
                      onProjectChange?.(nextProjectId);
                      const nextProject = projectOptions.find((item) => item.id === nextProjectId);
                      onEnvChange?.(nextProject?.envs[0]?.id ?? '');
                    }}
                  >
                    {projectOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="wm-field wm-field--aligned">
                <span>环境</span>
                <div className="wm-field__control">
                  <select
                    value={selectedEnvId}
                    disabled={!editableContext}
                    onChange={(event) => onEnvChange?.(event.target.value)}
                  >
                    {selectedProject.envs.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </>
          ) : null}

          <label className="wm-field wm-field--aligned">
            <span>
              账号 ID <b className="wm-required">*</b>
            </span>
            <div className="wm-field__control">
              <input
                value={draft.id}
                onChange={(event) => setDraft({ ...draft, id: event.target.value || createId('account') })}
              />
            </div>
          </label>

          {/* 按项目字段定义动态渲染输入项：敏感字段默认遮蔽并带眼睛切换按钮。 */}
          {project.fields.map((field) => (
            <label className="wm-field wm-field--aligned" key={field.key}>
              <span>
                {field.label}
                {field.required ? <b className="wm-required">*</b> : null}
              </span>
              <div className="wm-field__control">
                <div className={field.sensitive ? 'wm-input-affix' : undefined}>
                  <input
                    type={field.sensitive && !revealedFields[field.key] ? 'password' : 'text'}
                    className={requiredErrors[field.key] ? 'wm-input--error' : undefined}
                    value={draft.values[field.key] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraft({
                        ...draft,
                        values: {
                          ...draft.values,
                          [field.key]: value,
                        },
                      });
                      // 一旦填入非空内容即清除该字段的必填错误标记。
                      if (value.trim()) {
                        setRequiredErrors((prev) => {
                          const next = { ...prev };
                          delete next[field.key];
                          return next;
                        });
                      }
                    }}
                  />
                  {/* 敏感字段眼睛按钮：切换该字段明文/遮蔽显示，样式与登录页账号列表弹窗一致。 */}
                  {field.sensitive ? (
                    <button
                      className="wm-icon-btn"
                      type="button"
                      aria-label={revealedFields[field.key] ? '隐藏' : '显示'}
                      onClick={() =>
                        setRevealedFields((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
                      }
                    >
                      {revealedFields[field.key] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  ) : null}
                </div>
                {requiredErrors[field.key] ? <small className="wm-field__error">必填</small> : null}
              </div>
            </label>
          ))}

          <label className="wm-field wm-field--aligned wm-field--check">
            <span>默认账号</span>
            <div className="wm-field__control">
              <input
                type="checkbox"
                checked={draft.isDefault}
                onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })}
              />
            </div>
          </label>
        </div>

        <div className="wm-modal__footer">
          <div>
            {account && onDelete ? (
              <button type="button" className="wm-btn wm-btn--danger" onClick={() => onDelete(account)}>
                <Trash2 size={13} /> 删除
              </button>
            ) : null}
          </div>
          <div className="wm-inline">
            <button type="button" className="wm-btn" onClick={onClose}>
              取消
            </button>
            <button type="button" className="wm-btn wm-btn--primary" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
