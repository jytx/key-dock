// 页面匹配：根据当前 URL 的 host 与路径关键字，从配置中定位命中的项目与环境。
import type { FieldConfig, MatchedEnvironment, AppConfig } from './types';

// 归一化主机名：去掉 www. 前缀并转小写，便于比较。
function normalizeHost(host: string): string {
  return host.replace(/^www\./, '').toLowerCase();
}

// 判断主机名是否带端口后缀（如 app.com:8080）。
function hasPortSuffix(host: string): boolean {
  return /:\d+$/.test(host);
}

/** 在配置中查找与当前页面（host + 路径）匹配的环境；命中返回项目/环境及按 order 排序的字段，否则返回 null。 */
export function matchCurrentPage(
  config: AppConfig,
  urlLike: Pick<Location, 'host' | 'hostname' | 'pathname'> & Partial<Pick<Location, 'hash' | 'search'>>,
): MatchedEnvironment | null {
  // host 含端口（app.com:8080），hostname 不含端口（app.com）。
  const host = normalizeHost(urlLike.host || urlLike.hostname);
  const hostname = normalizeHost(urlLike.hostname || urlLike.host);
  // 路径用于关键字匹配，含 query 与 hash，以覆盖前端路由场景。
  const pagePath = `${urlLike.pathname}${urlLike.search ?? ''}${urlLike.hash ?? ''}`;

  for (const project of config.projects) {
    for (const env of project.envs) {
      const hosts = env.hosts ?? [];
      const keywords = env.pathKeywords ?? [];
      // host 匹配规则：
      // 1. 配置项带端口时，与含端口的实际 host 精确比较（支持按端口区分环境）；
      // 2. 配置项不带端口时，与不含端口的主机名比较，访问任意端口均视为命中
      //    （修复：此前一律按含端口 host 比较，配裸域名访问带端口站点匹配不上）。
      const hostMatched = hosts.some((item) => {
        const normalized = normalizeHost(item);
        const target = hasPortSuffix(normalized) ? host : hostname;
        return normalized === target || target.endsWith(`.${normalized}`);
      });
      // Path 关键字为空视为不限制路径：该主机下任意页面均命中，
      // 避免用户留空保存后静默失效（空数组的 some 恒为 false）。
      const pathMatched = keywords.length === 0 || keywords.some((keyword) => pagePath.includes(keyword));
      if (hostMatched && pathMatched) {
        return {
          project,
          env,
          fields: project.fields.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        };
      }
    }
  }

  return null;
}

/** 返回环境内默认账号的 id，没有则返回 null。 */
export function getDefaultAccountId(envAccounts: Array<{ id: string; isDefault: boolean }>): string | null {
  const found = envAccounts.find((item) => item.isDefault);
  return found?.id ?? null;
}

/** 字段是否为可填充的 input 类型。 */
export function isInputField(field: FieldConfig): boolean {
  return field.type === 'input';
}
