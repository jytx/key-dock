// 插件工具栏弹窗（popup）入口：识别当前标签页所属项目/环境，展示并填充该环境下账号，
// 通过向 content 脚本发消息完成「填充账号」「打开账号编辑器」等操作。
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronDown, ChevronRight, Pencil, Plus } from 'lucide-react';
import { APP_INFO } from '../shared/app-info';
import { ANALYTICS_PAGES, reportPageView } from '../shared/analytics';
import { PRODUCT_LINK, REPO_LINKS } from '../shared/constants';
import { readExtensionEnabled, writeExtensionEnabled } from '../shared/extension-state';
import { matchCurrentPage } from '../shared/match';
import { readAppConfig } from '../shared/storage';
import { getAppearanceClassName } from '../shared/theme';
import type { AccountRecord, AppearanceConfig, MatchedEnvironment } from '../shared/types';
import './styles.css';

type ActiveTab = {
  id?: number;
  url?: string;
};

// 展示 manifest 完整版本号（四段式，如 1.0.2.0），
// 每个构建批次递增一位，便于用户确认加载的确实是新版本。
function getDisplayVersion(): string {
  return chrome.runtime?.getManifest?.()?.version ?? APP_INFO.version;
}

function toUrlLike(urlText: string) {
  const url = new URL(urlText);
  return {
    host: url.host,
    hostname: url.hostname,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
  };
}

// 把账号的非敏感字段值拼成一行摘要用于列表展示，避免泄露密码等敏感信息。
function accountSummary(match: MatchedEnvironment, account: AccountRecord): string {
  const text = match.fields
    .filter((field) => !field.sensitive)
    .map((field) => account.values[field.key] ?? '')
    .filter(Boolean)
    .join('｜');
  return text || '未填写非敏感字段';
}

function Popup() {
  const [enabled, setEnabled] = useState(true);
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  const [matched, setMatched] = useState<MatchedEnvironment | null>(null);
  const [appearance, setAppearance] = useState<AppearanceConfig | null>(null);
  const [accountsExpanded, setAccountsExpanded] = useState(false);
  const [fillStatus, setFillStatus] = useState('');

  // 初始化：读取启用状态，查询当前活动标签页，并按其 URL 匹配出对应项目/环境。
  useEffect(() => {
    void readExtensionEnabled().then(setEnabled);
    void chrome.tabs.query({ active: true, currentWindow: true }, async (tabs: ActiveTab[]) => {
      const tab = tabs[0] ?? null;
      setActiveTab(tab);
      const config = await readAppConfig();
      setAppearance(config.global.appearance);
      // 仅对 http(s) 页面尝试匹配，跳过 chrome:// 等内部页。
      if (!tab?.url || !/^https?:/.test(tab.url)) return;
      setMatched(matchCurrentPage(config, toUrlLike(tab.url)));
    });
  }, []);

  // 切换到不同项目/环境时收起账号列表，避免沿用上一个上下文的展开态。
  useEffect(() => {
    setAccountsExpanded(false);
  }, [matched?.project.id, matched?.env.id]);

  async function toggleEnabled() {
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    await writeExtensionEnabled(nextEnabled);
  }

  // 打开独立的管理面板页（extension.html）并关闭弹窗。
  function openManager() {
    void chrome.tabs.create({
      url: chrome.runtime.getURL('extension.html'),
    });
    window.close();
  }

  // 向当前标签页的 content 脚本发送填充指令，由其在页面上完成自动填充。
  async function fillAccount(account: AccountRecord) {
    if (!activeTab?.id) return;
    setFillStatus('');
    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: 'WAA_FILL_ACCOUNT',
        accountId: account.id,
      });
      if (!response?.ok) {
        setFillStatus(response?.error ?? '填充失败');
        return;
      }
      window.close();
    } catch (error) {
      setFillStatus((error as Error).message);
    }
  }

  // 请求 content 脚本在页面内打开账号编辑器；account 为空表示新增。
  async function openAccountModal(account: AccountRecord | null) {
    if (!activeTab?.id) return;
    setFillStatus('');
    try {
      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: 'WAA_OPEN_ACCOUNT_EDITOR',
        accountId: account?.id,
      });
      if (!response?.ok) {
        setFillStatus(response?.error ?? '打开失败');
        return;
      }
      window.close();
    } catch (error) {
      setFillStatus((error as Error).message);
    }
  }

  return (
    <div className={`wm-popup-stage ${appearance ? getAppearanceClassName(appearance) : ''}`}>
      <main className="wm-popup">
        <header className="wm-popup__header">
          <span className="wm-popup__brand">
            <img className="wm-popup__logo" src={chrome.runtime.getURL('icons/logo.svg')} alt="" />
            <strong>{APP_INFO.productName}</strong>
          </span>
          <span className="wm-popup__version">v{getDisplayVersion()}</span>
        </header>

        <button className="wm-popup__item wm-popup__toggle-item" type="button" role="switch" aria-checked={enabled} onClick={() => void toggleEnabled()}>
          <span className={`wm-popup__toggle-track ${enabled ? 'wm-popup__toggle-track--on' : ''}`}>
            <span className="wm-popup__toggle-knob" />
          </span>
          <span>{enabled ? '已启用' : '已停用'}</span>
        </button>

        <div className="wm-popup__match">
          <div className="wm-popup__item wm-popup__match-row">
            <span className="wm-popup__match-label">{matched ? `${matched.project.name}-${matched.env.name}` : '未识别此页面'}</span>
            {matched ? (
              <span className="wm-popup__actions">
                <button
                  className="wm-popup__icon"
                  type="button"
                  aria-label="新增账号"
                  title="新增账号"
                  onClick={() => void openAccountModal(null)}
                >
                  <Plus size={14} />
                </button>
                <button
                  className="wm-popup__icon"
                  type="button"
                  aria-label={accountsExpanded ? '收起账号列表' : '展开账号列表'}
                  aria-expanded={accountsExpanded}
                  title={accountsExpanded ? '收起账号列表' : '展开账号列表'}
                  onClick={() => setAccountsExpanded((current) => !current)}
                >
                  {accountsExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </span>
            ) : null}
          </div>
          {matched && accountsExpanded ? (
            <div className="wm-popup__accounts">
              {matched.env.accounts.length === 0 ? <div className="wm-popup__empty">暂无账号</div> : null}
              {matched.env.accounts.map((account) => (
                <div className="wm-popup__account-row" key={account.id}>
                  <button className="wm-popup__account" type="button" onClick={() => void fillAccount(account)}>
                    {account.isDefault ? <span className="wm-default-mark" title="默认账号">默</span> : <span className="wm-default-mark-slot" aria-hidden="true" />}
                    <span className="wm-popup__account-text">{accountSummary(matched, account)}</span>
                  </button>
                  <button
                    className="wm-popup__icon"
                    type="button"
                    aria-label="编辑账号"
                    title="编辑账号"
                    onClick={() => void openAccountModal(account)}
                  >
                    <Pencil size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <button className="wm-popup__item" type="button" onClick={openManager}>
          <span>管理面板</span>
        </button>

        {fillStatus ? <div className="wm-popup__status">{fillStatus}</div> : null}

        <div className="wm-popup__links" aria-label="辅助链接">
          <a className="wm-popup__link" href={PRODUCT_LINK.url} target="_blank" rel="noopener noreferrer">
            {PRODUCT_LINK.label}
          </a>
          {REPO_LINKS.map((link) => (
            <a key={link.url} className="wm-popup__link" href={link.url} target="_blank" rel="noopener noreferrer">
              {link.label}
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);

// 上报一次工具栏弹窗 PV（百度统计）。
reportPageView(ANALYTICS_PAGES.popup);
