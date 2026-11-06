// 账号批量添加弹窗：选定项目/环境后，以表格形式一次录入多条账号。
// 支持动态增删行、按字段定义渲染列、必填校验；确认后批量上抛记录由调用方落盘。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { createId } from '../../shared/id';
import { useModalKeyboard } from '../../shared/use-modal-keyboard';
import type { AccountRecord, AppConfig } from '../../shared/types';

/** 表格行草稿：key 仅用于 React 渲染定位，保存时丢弃。 */
type BatchRow = {
  key: string;
  values: Record<string, string>;
  isDefault: boolean;
};

type BatchAddAccountsModalProps = {
  open: boolean;
  config: AppConfig;
  /** 打开时默认选中的项目/环境（一般取账号管理当前筛选上下文）。 */
  projectId: string;
  envId: string;
  onClose: () => void;
  onSave: (projectId: string, envId: string, records: AccountRecord[]) => void;
};

function createRow(): BatchRow {
  return { key: createId('row'), values: {}, isDefault: false };
}

/** 账号批量添加弹窗。表格列按项目字段定义动态渲染，敏感字段用密码框遮蔽。 */
export function BatchAddAccountsModal({ open, config, projectId, envId, onClose, onSave }: BatchAddAccountsModalProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(projectId);
  const [selectedEnvId, setSelectedEnvId] = useState(envId);
  const [rows, setRows] = useState<BatchRow[]>(() => [createRow(), createRow(), createRow()]);
  // 必填校验错误：行 key -> 字段 key -> 是否未填。
  const [errors, setErrors] = useState<Record<string, Record<string, boolean>>>({});
  const dialogRef = useRef<HTMLDivElement>(null);

  const selectedProject = useMemo(
    () => config.projects.find((item) => item.id === selectedProjectId) ?? null,
    [config, selectedProjectId],
  );

  // 键盘交互（ESC 关闭 / Tab 焦点陷阱 / 焦点归还）与账号编辑弹窗共用。
  useModalKeyboard(open, dialogRef, onClose);

  // 每次打开重置为「调用方上下文 + 3 行空行」，不残留上次未保存的录入。
  useEffect(() => {
    if (!open) return;
    setSelectedProjectId(projectId);
    setSelectedEnvId(envId);
    setRows([createRow(), createRow(), createRow()]);
    setErrors({});
  }, [open, projectId, envId]);

  if (!open || !selectedProject) return null;

  // 切换项目时环境重置为首个，避免沿用不存在于新项目的环境 id。
  function changeProject(nextProjectId: string) {
    const nextProject = config.projects.find((item) => item.id === nextProjectId);
    setSelectedProjectId(nextProjectId);
    setSelectedEnvId(nextProject?.envs[0]?.id ?? '');
  }

  // 整行所有字段均为空视为未使用的行，确认时跳过不写入。
  function isRowEmpty(row: BatchRow): boolean {
    return Object.values(row.values).every((value) => !value.trim());
  }

  // 校验非空行的必填字段；通过返回 true，失败则写入错误状态供标红。
  function validateRows(): boolean {
    if (!selectedProject) return false;
    const nextErrors: Record<string, Record<string, boolean>> = {};
    for (const row of rows) {
      if (isRowEmpty(row)) continue;
      const rowErrors: Record<string, boolean> = {};
      for (const field of selectedProject.fields) {
        if (field.required && !String(row.values[field.key] ?? '').trim()) {
          rowErrors[field.key] = true;
        }
      }
      if (Object.keys(rowErrors).length > 0) nextErrors[row.key] = rowErrors;
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  // 确认添加：过滤空行后逐行构造账号记录上抛。默认账号不在此层去重——
  // 由 saveAccount 的「同环境唯一默认」语义在落盘时收敛（后写的默认覆盖先前的）。
  function handleSave() {
    if (!validateRows()) return;
    const records: AccountRecord[] = rows
      .filter((row) => !isRowEmpty(row))
      .map((row) => ({
        id: createId('account'),
        values: { ...row.values },
        isDefault: row.isDefault,
        updatedAt: new Date().toISOString(),
      }));
    if (records.length === 0) return;
    onSave(selectedProjectId, selectedEnvId, records);
  }

  return (
    <div className="wm-overlay" role="presentation">
      <div ref={dialogRef} className="wm-modal wm-account-editor-modal" role="dialog" aria-modal="true">
        <div className="wm-modal__header">
          <strong>批量添加账号</strong>
          <button className="wm-icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="wm-modal__body">
          <div className="wm-grid wm-grid--2">
            <label className="wm-field">
              <span>项目 *</span>
              <select value={selectedProjectId} onChange={(event) => changeProject(event.target.value)}>
                {config.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="wm-field">
              <span>环境 *</span>
              <select value={selectedEnvId} onChange={(event) => setSelectedEnvId(event.target.value)}>
                {(selectedProject.envs ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <table className="wm-table">
            <thead>
              <tr>
                {selectedProject.fields.map((field) => (
                  <th key={field.key}>
                    {field.label}
                    {field.required ? ' *' : ''}
                  </th>
                ))}
                <th>默认账号</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key}>
                  {selectedProject.fields.map((field) => (
                    <td key={field.key}>
                      <input
                        type={field.sensitive ? 'password' : 'text'}
                        className={errors[row.key]?.[field.key] ? 'wm-input--error' : undefined}
                        value={row.values[field.key] ?? ''}
                        onChange={(event) =>
                          setRows((prev) =>
                            prev.map((item, i) =>
                              i === index ? { ...item, values: { ...item.values, [field.key]: event.target.value } } : item,
                            ),
                          )
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <input
                      type="checkbox"
                      checked={row.isDefault}
                      onChange={(event) =>
                        setRows((prev) => prev.map((item, i) => (i === index ? { ...item, isDefault: event.target.checked } : item)))
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="wm-btn wm-btn--danger"
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={13} /> 删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="wm-inline">
            <button className="wm-btn" type="button" onClick={() => setRows((prev) => [...prev, createRow()])}>
              <Plus size={14} /> 增加一行
            </button>
            <span className="wm-tiny">整行留空不会写入；同一环境仅最后一个默认账号生效</span>
          </div>
        </div>

        <div className="wm-modal__footer">
          <span className="wm-tiny">共 {rows.length} 行</span>
          <div className="wm-inline">
            <button type="button" className="wm-btn" onClick={onClose}>
              取消
            </button>
            <button type="button" className="wm-btn wm-btn--primary" onClick={handleSave}>
              确认添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
