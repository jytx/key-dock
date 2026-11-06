#!/usr/bin/env bash
# 打包脚本：先构建正式版，再将 dist/ 压制成 zip。
# zip 根目录直接是 manifest.json（不套外层文件夹），符合 Chrome 商店上传
# 与「加载已解压的扩展程序」两种使用方式；产物统一输出到 release/ 目录。
set -euo pipefail

# 定位项目根目录（本脚本位于 scripts/ 下）
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# 日志目录与日志文件（按时间戳命名）
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/package-$(date +%Y%m%d-%H%M%S).log"

# 从构建产物 manifest.json 读取版本号，作为 zip 文件名（版本唯一事实源）
read_version() {
  node -e "process.stdout.write(require('$PROJECT_ROOT/dist/manifest.json').version)"
}

# 主流程：输出经 tee 同时落盘日志；pipefail 保证管道中任一命令失败即整体失败
main() {
  echo "[package] 项目根目录：$PROJECT_ROOT"
  echo "[package] 日志文件：$LOG_FILE"

  # 第一步：构建正式版（含类型检查），任一失败即中止打包
  echo "[package] 步骤 1/3：构建正式版"
  bash "$PROJECT_ROOT/scripts/build.sh"

  # 第二步：按产物版本号压制 zip，排除 macOS 系统杂项文件
  local version zip_name release_dir
  version="$(read_version)"
  zip_name="keydock-v${version}.zip"
  release_dir="$PROJECT_ROOT/release"
  mkdir -p "$release_dir"
  rm -f "$release_dir/$zip_name"
  echo "[package] 步骤 2/3：打包 zip（版本 ${version}）"
  (
    cd "$PROJECT_ROOT/dist"
    zip -r -X -q "$release_dir/$zip_name" . -x "*.DS_Store" "__MACOSX/*"
  )

  # 第三步：校验 zip 根目录直接包含 manifest.json，并打印关键产物清单
  echo "[package] 步骤 3/3：校验产物"
  unzip -l "$release_dir/$zip_name" | awk '{print $4}' | grep -qx "manifest.json" \
    || { echo "[package] 校验失败：manifest.json 不在 zip 根目录"; exit 1; }
  unzip -l "$release_dir/$zip_name" | awk '{print $4}' \
    | grep -E "^(manifest.json|background.js|content.js|page-guard.js|popup.html|extension.html)$" \
    || { echo "[package] 校验失败：zip 内缺少关键文件"; exit 1; }
  echo "[package] 打包完成：$release_dir/$zip_name"
}

main "$@" 2>&1 | tee "$LOG_FILE"
