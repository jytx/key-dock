// content/index.tsx：内容脚本入口，向登录页注入悬浮面板/账号选择器，并实现一键填充。
// 职责包括：根据当前页面匹配项目/环境、渲染账号表格浮窗、监听输入框点击弹出账号选择器、
// 自动填充默认账号、与 popup 通过消息交互，以及把全部 UI 限制在 #web-account-assistant-root 内。
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { CSSProperties } from 'react';
import { Copy, Eye, EyeOff, Pencil, Plus, X } from 'lucide-react';
import rawPrimitives from '../shared/tokens/primitives.css';
import rawSemantic from '../shared/tokens/semantic.css';
import rawComponents from '../shared/tokens/components.css';
import rawStyles from '../extension/styles.css';
import { AccountEditorModal } from '../shared/AccountEditorModal';
import { copyText, createInputEvents, waitForSelector } from '../shared/account-utils';
import { resolveFillSelector } from '../shared/config-normalize';
import { STORAGE_KEY } from '../shared/defaults';
import { EXTENSION_ENABLED_KEY, readExtensionEnabled } from '../shared/extension-state';
import { matchCurrentPage, getDefaultAccountId } from '../shared/match';
import { readAppConfig, writeAppConfig } from '../shared/storage';
import { saveAccount, removeAccount, setDefaultAccount } from '../shared/config-ops';
import { DEFAULT_POPUP_POSITION } from '../shared/popup-position';
import { getAppearanceClassName } from '../shared/theme';
import type { AccountRecord, AppConfig, MatchedEnvironment, PopupPosition } from '../shared/types';

type PanelPositionState = {
  x: number;
  y: number;
  manual: boolean;
};

type ToastState = {
  x: number;
  y: number;
  text: string;
  variant: 'success' | 'error' | 'warning';
};

type AccountPickerState = {
  x: number;
  y: number;
  selectedIndex: number;
};

const PANEL_OFFSET = 24;
const TOAST_DURATION_MS = 1200;

// 登录页 PV 去重标志：内容脚本可能因配置变更多次重算匹配，但每次页面加载只应上报一次。
let loginPvReported = false;

/**
 * 上报一次「登录页填充」PV（百度统计），每页仅一次。
 * 内容脚本运行在隔离世界、直连 hm.gif 可能受宿主页 CSP 影响，故经后台 Service Worker 代发，
 * 既绕过宿主页 CSP，也不向宿主页暴露统计请求。
 */
function reportLoginPageView(): void {
  if (loginPvReported) return;
  loginPvReported = true;
  chrome.runtime?.sendMessage?.({ type: 'TRACK_PV', page: 'loginFill' });
}

/** 用当前页面 URL 匹配出命中的项目+环境（含字段配置与账号列表）；无匹配返回 null。 */
function findCurrentMatch(config: AppConfig): MatchedEnvironment | null {
  return matchCurrentPage(config, window.location);
}

/** 将项目配置的「弹窗位置」枚举映射为 fixed 定位样式（九宫格 + 居中）。 */
function getPanelAnchorStyle(position: PopupPosition): CSSProperties {
  switch (position) {
    case 'top-left':
      return { left: PANEL_OFFSET, top: PANEL_OFFSET };
    case 'left':
      return { left: PANEL_OFFSET, top: '50%', transform: 'translateY(-50%)' };
    case 'bottom-left':
      return { left: PANEL_OFFSET, bottom: PANEL_OFFSET };
    case 'top':
      return { left: '50%', top: PANEL_OFFSET, transform: 'translateX(-50%)' };
    case 'center':
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
    case 'bottom':
      return { left: '50%', bottom: PANEL_OFFSET, transform: 'translateX(-50%)' };
    case 'right':
      return { right: PANEL_OFFSET, top: '50%', transform: 'translateY(-50%)' };
    case 'bottom-right':
      return { right: PANEL_OFFSET, bottom: PANEL_OFFSET };
    case 'top-right':
    default:
      return { right: PANEL_OFFSET, top: PANEL_OFFSET };
  }
}

/**
 * 把扩展样式注入 shadow root（带去重 id）。
 * Shadow DOM 隔离保证：我们的样式不会泄漏到宿主页面（曾因向 <head> 注入整包样式，
 * 污染宿主页 body 字体与全部表单控件字体），宿主页样式也不会渗入浮窗。
 */
function injectShadowStyles(shadow: ShadowRoot) {
  const id = 'web-account-assistant-style';
  if (shadow.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  const allStyles = [rawPrimitives, rawSemantic, rawComponents, rawStyles].join('\n');
  style.textContent = toShadowStyles(allStyles);
  shadow.appendChild(style);
}

/**
 * 把扩展样式改写为 Shadow DOM 内可用形式。
 * shadow 内所有规则天然限定在影子树中，无需再做选择器前缀化；
 * 仅需处理两点：
 * 1. `:root` 在 shadow 内不命中任何元素，改为 `:host` 使 CSS 变量可被影子树继承；
 * 2. `body` 在 shadow 内不存在，其字体规则搬到 `:host`，避免浮窗继承宿主页正文字体。
 */
function toShadowStyles(styles: string): string {
  return styles
    .replace(/@import\s+['"][^'"]*['"];?\s*/g, '')
    .replace(/:root\s*\{/g, ':host {')
    .replace(/body\s*\{/g, ':host {');
}

/** 按命中环境的字段配置，将所选账号写入对应输入框；写值后派发原生事件以兼容受控表单。 */
async function fillMatchedAccount(currentMatch: MatchedEnvironment, account: AccountRecord) {
  for (const field of currentMatch.fields) {
    if (field.type !== 'input') continue;
    const selector = resolveFillSelector(field, currentMatch.fields);
    if (!selector) continue;
    const element = await waitForSelector(selector, currentMatch.env.retryDelays);
    if (!element) continue;
    const value = account.values[field.key] ?? '';
    if ('value' in element) {
      (element as HTMLInputElement | HTMLTextAreaElement).value = value;
      // Native input/change events are required for React/Vue/Angular controlled
      // fields to notice values written by the extension.
      createInputEvents(element as HTMLInputElement | HTMLTextAreaElement);
    }
  }
}

/** 拼出账号在选择器中的展示文本：仅取非敏感字段，用 | 连接，用于区分同环境下的多个账号。 */
function accountInfoText(currentMatch: MatchedEnvironment, account: AccountRecord): string {
  const text = currentMatch.fields
    .filter((field) => !field.sensitive)
    .map((field) => account.values[field.key] ?? '')
    .filter(Boolean)
    .join('|');
  return text || '未填写非敏感字段';
}

/** 判断点击目标是否为当前环境配置过的某个填充输入框，决定是否在该处弹出账号选择器。 */
function isConfiguredInputTarget(target: EventTarget | null, currentMatch: MatchedEnvironment): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return currentMatch.fields.some((field) => {
    if (field.type !== 'input') return false;
    const selector = resolveFillSelector(field, currentMatch.fields);
    if (!selector) return false;
    try {
      return target.matches(selector);
    } catch {
      // 选择器写法可能非法，matches 抛错时视为不匹配而非中断点击处理。
      return false;
    }
  });
}

/** 登录页注入的主面板组件：渲染账号表格浮窗与账号选择器，承载填充/复制/编辑等交互。 */
function Panel() {
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [matched, setMatched] = useState<MatchedEnvironment | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState('');
  const [position, setPosition] = useState<PanelPositionState>({ x: PANEL_OFFSET, y: PANEL_OFFSET, manual: false });
  const [toast, setToast] = useState<ToastState | null>(null);
  const [accountPicker, setAccountPicker] = useState<AccountPickerState | null>(null);
  const [accountModal, setAccountModal] = useState<{
    open: boolean;
    account?: AccountRecord | null;
  }>({ open: false, account: null });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const autoFillTokenRef = useRef('');
  const toastTimerRef = useRef<number | null>(null);
  const revealTimersRef = useRef<Record<string, number>>({});
  const panelRef = useRef<HTMLDivElement | null>(null);
  const accountPickerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; originX: number; originY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  async function loadConfig() {
    const nextEnabled = await readExtensionEnabled();
    setEnabled(nextEnabled);
    if (!nextEnabled) return;
    const config = await readAppConfig();
    setAppConfig(config);
    setMatched(findCurrentMatch(config));
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    const onChanged = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local') return;
      if (changes[EXTENSION_ENABLED_KEY]) {
        const nextEnabled = changes[EXTENSION_ENABLED_KEY].newValue !== false;
        setEnabled(nextEnabled);
        if (nextEnabled) {
          setVisible(true);
          void loadConfig();
        } else {
          setMatched(null);
        }
        return;
      }
      if (changes[STORAGE_KEY]) {
        void loadConfig();
      }
    };
    chrome.storage?.onChanged?.addListener(onChanged);
    return () => {
      chrome.storage?.onChanged?.removeListener(onChanged);
    };
  }, []);

  useEffect(() => {
    if (!appConfig) return;
    const nextMatched = findCurrentMatch(appConfig);
    setMatched(nextMatched);
  }, [appConfig]);

  // 当前页面命中项目/环境（即登录填充 UI 生效）时，上报一次「登录页填充」PV。
  useEffect(() => {
    if (matched) reportLoginPageView();
  }, [matched]);

  useEffect(() => {
    if (!panelMountPoint || !appConfig) return;
    // 主题类挂在 shadow 内的挂载容器上，shadow 内样式规则据此生效。
    panelMountPoint.className = getAppearanceClassName(appConfig.global.appearance);
  }, [appConfig]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      setPosition({
        x: Math.max(8, dragRef.current.originX + (event.clientX - dragRef.current.startX)),
        y: Math.max(8, dragRef.current.originY + (event.clientY - dragRef.current.startY)),
        manual: true,
      });
    };
    const onUp = () => {
      dragRef.current.dragging = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      for (const timer of Object.values(revealTimersRef.current)) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  useEffect(() => {
    if (!matched || !appConfig) return;
    const defaultId = getDefaultAccountId(matched.env.accounts);
    if (!defaultId) return;
    const token = `${matched.project.id}:${matched.env.id}:${defaultId}:${location.href}`;
    if (autoFillTokenRef.current === token) return;
    autoFillTokenRef.current = token;
    const account = matched.env.accounts.find((item) => item.id === defaultId);
    if (account) {
      void fillMatchedAccount(matched, account).catch((error: Error) => setStatus(error.message));
    }
  }, [appConfig, matched]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!matched || !appConfig?.global.showAccountPickerOnInputClick) {
        setAccountPicker(null);
        return;
      }
      // 事件穿过 shadow 边界时 composedPath 仍包含影子树内的真实节点，
      // 而 event.target 会被 retarget 为 shadow host，不能用 contains 判断。
      if (accountPickerRef.current && event.composedPath().includes(accountPickerRef.current)) return;
      if (!isConfiguredInputTarget(event.target, matched)) {
        setAccountPicker(null);
        return;
      }
      setAccountPicker({ x: event.clientX, y: event.clientY, selectedIndex: 0 });
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
    };
  }, [appConfig?.global.showAccountPickerOnInputClick, matched]);

  useEffect(() => {
    if (!accountPicker || !matched) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const accounts = [...matched.env.accounts].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      if (event.key === 'Escape') {
        setAccountPicker(null);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') return;
      event.preventDefault();
      if (accounts.length === 0) return;
      if (event.key === 'ArrowDown') {
        setAccountPicker((prev) => (prev ? { ...prev, selectedIndex: Math.min(accounts.length - 1, prev.selectedIndex + 1) } : prev));
        return;
      }
      if (event.key === 'ArrowUp') {
        setAccountPicker((prev) => (prev ? { ...prev, selectedIndex: Math.max(0, prev.selectedIndex - 1) } : prev));
        return;
      }
      const account = accounts[accountPicker.selectedIndex] ?? accounts[0];
      void pickAccount(account);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [accountPicker, matched]);

  useEffect(() => {
    const onMessage = (
      message: { type?: string; accountId?: string },
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => {
      if (message?.type !== 'WAA_FILL_ACCOUNT' && message?.type !== 'WAA_OPEN_ACCOUNT_EDITOR') return false;
      readAppConfig()
        .then((config) => {
          const nextMatched = findCurrentMatch(config);
          setAppConfig(config);
          setMatched(nextMatched);
          if (!nextMatched) {
            sendResponse({ ok: false, error: '未识别此页面' });
            return;
          }
          if (message.type === 'WAA_OPEN_ACCOUNT_EDITOR') {
            const nextAccount = message.accountId ? nextMatched.env.accounts.find((item) => item.id === message.accountId) : null;
            if (message.accountId && !nextAccount) {
              sendResponse({ ok: false, error: '未找到账号' });
              return;
            }
            setVisible(true);
            setAccountModal({ open: true, account: nextAccount ?? null });
            sendResponse({ ok: true });
            return;
          }
          const nextAccount = nextMatched.env.accounts.find((item) => item.id === message.accountId);
          if (!nextAccount) {
            sendResponse({ ok: false, error: '未找到账号' });
            return;
          }
          fillMatchedAccount(nextMatched, nextAccount)
            .then(() => sendResponse({ ok: true }))
            .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
        })
        .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
      return true;
    };
    chrome.runtime?.onMessage?.addListener(onMessage);
    return () => {
      chrome.runtime?.onMessage?.removeListener(onMessage);
    };
  }, []);

  if (!enabled || !matched || !appConfig) return null;

  const config = appConfig;
  const currentMatch = matched;
  const project = currentMatch.project;
  const env = currentMatch.env;
  const showPanel = visible && appConfig.global.showLoginAccountPanel;
  const pickerAccounts = [...env.accounts].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  async function save(nextConfig: AppConfig, nextStatus = '已保存到本地') {
    setAppConfig(nextConfig);
    setStatus(nextStatus);
    await writeAppConfig(nextConfig);
  }

  async function fillAccount(account: AccountRecord, silent = false, toastTarget?: HTMLElement) {
    try {
      await fillMatchedAccount(currentMatch, account);
      showPanelToast(silent ? '默认账号已尝试填充' : '已填充账号', toastTarget);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function pickAccount(account: AccountRecord) {
    setAccountPicker(null);
    try {
      await fillMatchedAccount(currentMatch, account);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function openAccountEditor(account?: AccountRecord | null) {
    setAccountModal({ open: true, account: account ?? null });
  }

  async function saveAccountDraft(record: AccountRecord) {
    if (!config) return;
    let next = saveAccount(config, project.id, env.id, record);
    if (record.isDefault) {
      next = setDefaultAccount(next, project.id, env.id, record.id);
    }
    await save(next, '账号已保存');
    setAccountModal({ open: false, account: null });
  }

  async function deleteAccountItem(accountId: string): Promise<boolean> {
    if (!config) return false;
    if (!confirm('确认删除该账号？')) return false;
    const next = removeAccount(config, project.id, env.id, accountId);
    await save(next, '账号已删除');
    return true;
  }

  function showToastAt(x: number, y: number, text: string, variant: ToastState['variant'] = 'success') {
    setToast({ x, y, text, variant });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  function showToast(target: HTMLElement, text: string, variant: ToastState['variant'] = 'success') {
    const rect = target.getBoundingClientRect();
    showToastAt(rect.left + rect.width / 2, rect.top - 8, text, variant);
  }

  function showPanelToast(text: string, target?: HTMLElement, variant: ToastState['variant'] = 'success') {
    if (target) {
      showToast(target, text, variant);
      return;
    }
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) {
      showToastAt(rect.left + rect.width / 2, rect.top - 8, text, variant);
      return;
    }
    showToastAt(window.innerWidth / 2, 24, text, variant);
  }

  function toggleReveal(cellKey: string) {
    setRevealed((prev) => {
      const next = { ...prev, [cellKey]: !prev[cellKey] };
      if (revealTimersRef.current[cellKey]) {
        window.clearTimeout(revealTimersRef.current[cellKey]);
        delete revealTimersRef.current[cellKey];
      }
      if (next[cellKey]) {
        revealTimersRef.current[cellKey] = window.setTimeout(() => {
          setRevealed((r) => ({ ...r, [cellKey]: false }));
          delete revealTimersRef.current[cellKey];
        }, 10000);
      }
      return next;
    });
  }

  async function copyField(account: AccountRecord, key: string, target: HTMLElement) {
    try {
      await copyText(account.values[key] ?? '');
      showToast(target, '已复制', 'success');
    } catch (error) {
      showToast(target, (error as Error).message, 'error');
    }
  }

  function startDrag(event: import('react').MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    dragRef.current.dragging = true;
    dragRef.current.startX = event.clientX;
    dragRef.current.startY = event.clientY;
    dragRef.current.originX = rect.left;
    dragRef.current.originY = rect.top;
  }

  const panelStyle = {
    position: 'fixed' as const,
    zIndex: 2147483647,
    width: 'max-content',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    ...(position.manual ? { left: position.x, top: position.y } : getPanelAnchorStyle(project.popupPosition ?? DEFAULT_POPUP_POSITION)),
  };

  return (
    <>
      {showPanel ? (
        <div className="wm-panel" ref={panelRef} style={panelStyle}>
          <div className="wm-panel__hd" onMouseDown={startDrag} style={{ cursor: 'move' }}>
            <div className="wm-title">
              <strong className="wm-subtitle">{project.name} {env.name}</strong>
              {status ? <span className="wm-tiny">{status}</span> : null}
            </div>
            <div className="wm-inline">
              <button className="wm-btn wm-btn--sm" type="button" onClick={() => void openAccountEditor(null)}>
                <Plus size={13} /> 新增
              </button>
              <button className="wm-icon-btn" type="button" onClick={() => setVisible(false)}>
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="wm-panel__bd" style={{ maxHeight: 'calc(100vh - 94px)', overflow: 'auto' }}>
            <table className="wm-table wm-account-table">
              <thead>
                <tr>
                  <th className="wm-default-col" aria-label="默认账号" />
                  {currentMatch.fields.map((field) => (
                    <th key={field.key}>
                      <span>{field.label}</span>
                    </th>
                  ))}
                  <th className="wm-actions-col">操作</th>
                </tr>
              </thead>
              <tbody>
                {env.accounts.map((account) => (
                  <tr key={account.id}>
                    <td className="wm-default-col">
                      {account.isDefault ? <span className="wm-default-mark" title="默认账号">默</span> : <span className="wm-default-mark-slot" aria-hidden="true" />}
                    </td>
                    {currentMatch.fields.map((field) => {
                      const cellKey = `${account.id}:${field.key}`;
                      const hidden = field.sensitive && !revealed[cellKey];
                      return (
                        <td key={cellKey}>
                          <div className="wm-cell">
                            <span className="wm-code wm-cell__text">
                              {hidden ? '••••••' : account.values[field.key] ?? ''}
                            </span>
                            {field.sensitive || field.copyable !== false ? (
                              <div className="wm-cell__tools">
                                {field.sensitive ? (
                                  <button
                                    className="wm-icon-btn"
                                    type="button"
                                    onClick={() => toggleReveal(cellKey)}
                                  >
                                    {hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                                  </button>
                                ) : null}
                                {field.copyable !== false ? (
                                  <button className="wm-icon-btn" type="button" onClick={(event) => void copyField(account, field.key, event.currentTarget)}>
                                    <Copy size={13} />
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </td>
                      );
                    })}
                    <td>
                      <div className="wm-table__actions">
                        <button className="wm-btn" type="button" onClick={(event) => void fillAccount(account, false, event.currentTarget)}>
                          填充
                        </button>
                        <button className="wm-btn" type="button" onClick={() => void openAccountEditor(account)}>
                          <Pencil size={13} /> 编辑
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <AccountEditorModal
        open={accountModal.open}
        project={project}
        projects={[project]}
        projectId={project.id}
        envId={env.id}
        lockContext
        account={accountModal.account ?? null}
        title={accountModal.account ? '编辑账号' : '新增账号'}
        onClose={() => setAccountModal({ open: false, account: null })}
        onSave={(record) => void saveAccountDraft(record)}
        onDelete={
          accountModal.account
            ? (account) => {
                void deleteAccountItem(account.id).then((deleted) => {
                  if (deleted) setAccountModal({ open: false, account: null });
                });
              }
            : undefined
        }
      />
      {accountPicker && appConfig.global.showAccountPickerOnInputClick ? (
        <div
          className="wm-account-picker"
          ref={accountPickerRef}
          style={{ left: accountPicker.x, top: accountPicker.y }}
          onMouseLeave={() => setAccountPicker(null)}
        >
          {pickerAccounts.length > 0 ? (
            pickerAccounts.map((account, index) => (
              <button
                className={`wm-account-picker__item ${accountPicker.selectedIndex === index ? 'wm-account-picker__item--active' : ''}`}
                type="button"
                key={account.id}
                onMouseEnter={() => setAccountPicker((prev) => (prev ? { ...prev, selectedIndex: index } : prev))}
                onClick={() => void pickAccount(account)}
              >
                {account.isDefault ? <span className="wm-default-mark" title="默认账号">默</span> : <span className="wm-default-mark-slot" aria-hidden="true" />}
                <span className="wm-account-picker__text">{accountInfoText(currentMatch, account)}</span>
              </button>
            ))
          ) : (
            <div className="wm-account-picker__empty">暂无账号</div>
          )}
        </div>
      ) : null}
      {toast ? (
        <div className={`wm-toast wm-toast--${toast.variant}`} style={{ left: toast.x, top: toast.y }}>
          {toast.text}
        </div>
      ) : null}
    </>
  );
}

// 模块级挂载控制器：把「挂载/卸载」决策上移到启用开关，使「启用开关」成为页面注入的总闸。
// 同一扩展可能存在两份实例（Chrome 商店正式版 + 本地开发版），二者都向 <all_urls> 注入并
// 争抢同一份页面共享资源（根节点 id、样式节点）。被关闭的实例必须彻底释放这些资源，
// 启用着的另一份实例下次页面加载时才能正常占用并工作。
let panelRoot: Root | null = null;
let panelHost: HTMLElement | null = null;
// shadow 内的 React 挂载容器：主题类需要挂在它上面，shadow 内样式规则才能命中。
let panelMountPoint: HTMLElement | null = null;

function mountPanel() {
  // 根节点已被（本实例或另一实例）占用则不重复挂载。
  if (document.getElementById('web-account-assistant-root')) return;
  // 全部注入 UI 收进 Shadow DOM：宿主页样式进不来、我们的样式出不去，
  // 从根本上避免扩展影响宿主页面（含用户自己的前端项目）。
  const host = document.createElement('div');
  host.id = 'web-account-assistant-root';
  (document.body ?? document.documentElement).appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  injectShadowStyles(shadow);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  panelHost = host;
  panelMountPoint = mountPoint;
  panelRoot = createRoot(mountPoint);
  panelRoot.render(<Panel />);
}

function unmountPanel() {
  // 释放共享资源：卸载 React、移除根节点（shadow 与其中样式随之销毁），让另一份启用实例能够接管。
  if (panelRoot) {
    panelRoot.unmount();
    panelRoot = null;
  }
  if (panelHost?.parentNode) {
    panelHost.parentNode.removeChild(panelHost);
  }
  panelHost = null;
  panelMountPoint = null;
  // 兼容清理：移除旧版本遗留在页面 <head> 中的样式节点（新版样式已收进 shadow）。
  document.getElementById('web-account-assistant-style')?.remove();
}

async function syncEnabledState() {
  const enabled = await readExtensionEnabled();
  if (enabled) {
    mountPanel();
  } else {
    unmountPanel();
  }
}

// 同会话内开关「启用」时即时卸载/挂载自身（释放或重新占用根节点）。
chrome.storage?.onChanged?.addListener((changes: Record<string, unknown>, areaName: string) => {
  if (areaName !== 'local') return;
  if (changes[EXTENSION_ENABLED_KEY]) {
    void syncEnabledState();
  }
});

// 启动入口：禁用的实例从一开始就不创建根节点，启用的实例正常占用。
void syncEnabledState();
