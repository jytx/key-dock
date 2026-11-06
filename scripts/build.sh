#!/usr/bin/env bash
# 构建脚本：类型检查 + 正式版构建（用于上架 / 分发的正式产物）。
# 所有输出同时写入 logs/ 目录下的带时间戳日志，便于回溯问题。
set -euo pipefail

# 定位项目根目录（本脚本位于 scripts/ 下）
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# 日志目录与日志文件（按时间戳命名）
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/build-$(date +%Y%m%d-%H%M%S).log"

# 主流程：输出经 tee 同时落盘日志；pipefail 保证管道中任一命令失败即整体失败
main() {
  echo "[build] 项目根目录：$PROJECT_ROOT"
  echo "[build] 日志文件：$LOG_FILE"

  # 依赖未安装时先按锁文件安装，保证构建可复现
  if [ ! -d "$PROJECT_ROOT/node_modules" ]; then
    echo "[build] 未检测到 node_modules，执行 pnpm install --frozen-lockfile"
    pnpm install --frozen-lockfile
  fi

  echo "[build] 步骤 1/2：类型检查（pnpm check）"
  pnpm check

  echo "[build] 步骤 2/2：正式版构建（pnpm build，产物输出到 dist/）"
  pnpm build

  echo "[build] 构建完成，产物目录：$PROJECT_ROOT/dist"
}

main "$@" 2>&1 | tee "$LOG_FILE"
