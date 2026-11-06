// 应用元信息常量与展示标题工具。
/** 产品名称、版本、官网与仓库等静态信息（全局只读）。 */
export const APP_INFO = {
  productName: '钥栈',
  englishName: 'KeyDock',
  displayName: '钥栈 KeyDock',
  version: '1.0.2.9',
  description: '多环境 Web 账号管理与登录填充 Chrome 插件。',
  homepageUrl: 'https://keydock.asgc.fun',
  githubUrl: 'https://github.com/aoshiguchen/key-dock',
  giteeUrl: 'https://gitee.com/asgc/key-dock',
  // 百度统计站点配置（集中维护，更换统计站点只需改这两项）。
  // baiduTongjiId：百度统计后台「自有网站」的站点 key（hm.gif 的 si 参数）。
  // analyticsDomain：百度统计后台登记的网站域名；插件各页面以该域名下的虚拟路径上报，
  //   既能通过百度的域名校验，又避免把宿主页真实 URL 泄露给百度（见 analytics.ts）。
  baiduTongjiId: '08c5dbc54c18c94652910ac33d1a6467',
  analyticsDomain: 'chrome-plugin.keydock.asgc.fun',
} as const;

/** 取「名称-版本」展示标题：优先读 manifest，缺失时回退到 APP_INFO。 */
export function getAppDisplayTitle(): string {
  const manifest = typeof chrome !== 'undefined' ? chrome.runtime?.getManifest?.() : null;
  const name = manifest?.name ?? APP_INFO.displayName;
  const version = manifest?.version ?? APP_INFO.version;
  return `${name}-${version}`;
}
