<div align="center">

<img src="asset/logo/origin/icon-128.png" width="112" height="112" alt="钥栈 KeyDock logo" />

# 钥栈 · KeyDock

**面向多环境 Web 系统的 Chrome 账号管理与登录填充插件**

把散落在各个系统、各套环境里的账号「钥匙」，统一停靠、随取随填。

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.0.2.4-38b6ff.svg)
![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-1ce8a0.svg)
![React 18](https://img.shields.io/badge/React-18-61dafb.svg)
![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178c6.svg)

[🌐 官网](https://keydock.asgc.fun/) · [🧩 Chrome 应用商店](https://chromewebstore.google.com/detail/%E9%92%A5%E6%A0%88-keydock/miijhlakpjkbkobnfoaophjdoeldlpac) · [💻 GitHub](https://github.com/aoshiguchen/key-dock) · [🦊 Gitee](https://gitee.com/asgc/key-dock)

</div>

---

## ✨ 简介

如果你也常年穿梭在 **开发 / 测试 / 预发 / 生产** 多套环境之间，手里攥着一大把账号密码——
复制粘贴、来回切换、记不住哪个环境用哪组账号……**钥栈 KeyDock** 就是为此而生。

它是一款独立的 **Chrome Manifest V3** 插件：在你打开登录页的那一刻，自动识别出「这是哪个项目的哪个环境」，弹出对应的账号列表，一键填充、一键复制，让登录这件小事彻底不再分心。

- 🧱 **技术栈**：React 18 + TypeScript 5 + Vite 5，Chrome MV3 Service Worker，`lucide-react` 图标，三层 Design Token 主题体系。
- 🗄️ **数据存储**：默认使用 Chrome 本地存储（`storage.local`），无需任何服务端即可完整使用；可选接入 **MinIO** 做多端同步。
- 🔓 **定位**：一款顺手的「**多环境登录助手**」，而非加密保险箱。本版本以明文存储 + 敏感字段默认隐藏 + 风险提示为安全策略（详见下文）。
- 📜 **开源协议**：[MIT](LICENSE)，自由使用与二次开发。
- 🌐 **官网**：<https://keydock.asgc.fun/>

> 🧭 **命名的由来**
> **钥** 取自「钥匙」，象征你手中的每一组账号密钥；**栈** 既是栈房、栈道——存放与中转之所，也呼应技术语境里的「栈（stack）」。
> 英文名 **KeyDock** = `Key`（钥匙 / 账号）+ `Dock`（船坞 / 停靠坞 / 工具坞）。
> 合在一起：**让所有账号钥匙都有一个井然有序的「停靠坞」，需要时随手取用。** 这正是这款插件想为你做的事。

---

## 🎯 核心功能

### 它解决了什么痛点？

| 痛点 | 钥栈的解法 |
|------|-----------|
| 多环境账号记不住、找不到 | 打开登录页**自动识别项目 + 环境**，弹出对应账号列表 |
| 反复复制粘贴账号密码 | **一键填充 / 一键复制**，敏感字段点一下临时显示、10 秒自动隐藏 |
| 默认账号每次都要手点 | 标记默认账号后，匹配页面**自动填充** |
| 账号字段五花八门（不止账号/密码） | **自定义字段模型**：输入型 / 展示型、敏感、必填、可复制、列宽自适应 |
| 配置散乱、换设备难迁移 | 单一「完整配置 JSON」+ **导入导出** + 可选 **MinIO 多端同步** |
| 本地调试版和商店版傻傻分不清 | 内置 **DEV 角标 + 专用构建**，开发与日常使用互不干扰 |

### 功能一览

- 🔍 **智能页面识别**：按 `host`（支持子域）+ `path` 关键字双重匹配，命中才出现，不打扰其他页面。
- 🪟 **登录页账号浮窗**：展示当前项目 / 环境的全部账号；支持拖动定位、9 锚点自动停靠、列宽自适应。
- ⚡ **自动填充与重试**：写入后派发 `input/change/blur` 事件，兼容 React / Vue / Angular 受控组件；按环境重试延迟逐次查找元素。
- 🖱️ **输入框账号选择器**：点击输入框即弹出账号候选，支持 ↑/↓/Enter/Esc 键盘操作。
- 🗂️ **配置管理面板（七大模块）**：全局配置 · 项目分组 · 项目管理 · 字段配置模板 · 账号管理 · 配置导入导出 · 数据同步。
- 🎨 **三套主题 + 字号 + 动效**：科技黑 / 简约白 / 灵动炫彩，全局生效（配置页、popup、登录页浮窗一致）。
- ☁️ **可选 MinIO 同步**：远程 ↔ 本地按稳定标识增量合并或整体覆盖；不启用则零外联，纯本地可用。
- 🛡️ **登录页解密容错**：在 `/login` 路径对宿主页 `CryptoJS.AES.decrypt` 做兜底补丁，避免个别站点登录脚本异常中断。

---

## 🚀 快速上手

### 1. 安装

前往 **Chrome 应用商店** 一键安装（推荐）：

> 👉 **[钥栈 KeyDock · Chrome 应用商店详情页](https://chromewebstore.google.com/detail/%E9%92%A5%E6%A0%88-keydock/miijhlakpjkbkobnfoaophjdoeldlpac)**

也可以下载源码自行构建后「加载已解压的扩展程序」，详见 [开发指南](#-开发指南)。

### 2. 配置

1. 点击工具栏的钥栈图标，打开 **Popup**，再进入 **管理面板**。
2. 在 **项目管理** 中新建项目：填写项目名、所属分组，配置 **字段**（账号、密码、备注……可自定义）与 **环境**（Host、Path 关键字）。
3. 在 **账号管理** 或直接在登录页浮窗里 **新增账号**，按需标记默认账号。
4. （可选）在 **数据同步** 配置 MinIO，实现多端共享同一份配置。

### 3. 使用

打开任意已配置环境的登录页 → 钥栈自动识别并弹出账号浮窗 → **点击填充 / 复制**，或让默认账号自动填好。完成。✅

---

## 🖼️ 运行示例

<table>
  <tr>
    <td align="center"><img src="asset/run-example/%E7%99%BB%E9%99%86%E9%A1%B5-%E8%BE%93%E5%85%A5%E6%A1%86%E4%B8%8B%E6%8B%89%26%E8%B4%A6%E5%8F%B7%E5%88%97%E8%A1%A8%E6%B5%AE%E7%AA%97.png" width="420" /><br/><sub>登录页浮窗 & 输入框账号选择器</sub></td>
    <td align="center"><img src="asset/run-example/popup%E5%BC%B9%E7%AA%97.png" width="420" /><br/><sub>工具栏 Popup</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="asset/run-example/%E9%A1%B9%E7%9B%AE%E7%AE%A1%E7%90%86-%E5%88%97%E8%A1%A8.png" width="420" /><br/><sub>项目管理</sub></td>
    <td align="center"><img src="asset/run-example/%E9%A1%B9%E7%9B%AE%E7%AE%A1%E7%90%86-%E5%AD%97%E6%AE%B5%E9%85%8D%E7%BD%AE.png" width="420" /><br/><sub>字段配置</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="asset/run-example/%E9%A1%B9%E7%9B%AE%E7%AE%A1%E7%90%86-%E7%8E%AF%E5%A2%83%E9%85%8D%E7%BD%AE.png" width="420" /><br/><sub>环境配置</sub></td>
    <td align="center"><img src="asset/run-example/%E8%B4%A6%E5%8F%B7%E7%AE%A1%E7%90%86.png" width="420" /><br/><sub>账号管理</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="asset/run-example/%E6%95%B0%E6%8D%AE%E5%90%8C%E6%AD%A5.png" width="420" /><br/><sub>数据同步（MinIO）</sub></td>
    <td align="center"><img src="asset/run-example/%E5%85%A8%E5%B1%80%E9%85%8D%E7%BD%AE.png" width="420" /><br/><sub>全局配置 & 主题</sub></td>
  </tr>
</table>

> 更多截图见 [`asset/run-example/`](asset/run-example/)：项目分组、字段配置模板、配置导入导出等。

---

## 🛠️ 开发指南

想参与共建或本地二次开发？欢迎 👏。详细文档收纳在 [`docs/`](docs/) 下，按主题分册阅读：

- 🧰 **本地开发 / 构建 / 调试流程** → [`docs/coding/dev-guide.md`](docs/coding/dev-guide.md)
- 🏗️ **整体架构 & 技术点说明** → [`docs/design/v1.0.0/architecture.md`](docs/design/v1.0.0/architecture.md)
- 📁 **项目结构 & 模块设计** → [`docs/design/v1.0.0/module-design.md`](docs/design/v1.0.0/module-design.md)
- 📐 **数据模型 & 校验规则** → [`docs/design/v1.0.0/data-model.md`](docs/design/v1.0.0/data-model.md)
- ☁️ **同步与合并引擎设计** → [`docs/design/v1.0.0/sync-design.md`](docs/design/v1.0.0/sync-design.md)
- 📋 **需求说明** → [`docs/requirements/v1.0.0/README.md`](docs/requirements/v1.0.0/README.md)

常用命令（包管理器为 **pnpm**）：

```bash
pnpm install      # 安装依赖
pnpm dev          # 启动 Vite 开发服务
pnpm check        # tsc --noEmit 类型检查
pnpm build        # 构建正式版（用于上架）到 dist/
pnpm build:dev    # 构建本地开发版（[DEV] 名称 + 红色图标，便于与商店版区分）
```

> 提交前请至少跑通 `pnpm check` 与 `pnpm build`。

---

## 🔐 安全与隐私

钥栈定位为「多环境登录助手」，**非加密保险箱**，请知悉本版本的安全边界：

- 本地配置、导出 JSON、云端配置及 MinIO 连接信息均**以明文形式存储**。
- 敏感字段默认以 `••••••` 隐藏，临时显示后 **10 秒自动恢复**。
- 账号辅助**仅在你配置过的匹配页面**生效；`page-guard` 仅在 `/login` 路径介入。
- 是否启用 MinIO 完全由你决定；**不启用即零外联**，数据只留在本地浏览器。

请勿在公共 / 不受信设备上存放高敏感账号。

---

## 🤝 联系我们

钥栈是一个开源项目，欢迎 Issue、PR、Star 与建议 🌟

- 💻 **GitHub**：<https://github.com/aoshiguchen/key-dock>
- 🦊 **Gitee**：<https://gitee.com/asgc/key-dock>
- 🌐 **官网**：<https://keydock.asgc.fun/>
- 💬 **作者微信**：`yuyunshize`（备注「钥栈」更易通过）

---

<div align="center">
<sub>用 ❤️ 打造 · 基于 <a href="LICENSE">MIT</a> 协议开源 · 钥栈 KeyDock</sub>
</div>
