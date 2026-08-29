#!/usr/bin/env bash
# 推送应付宝桌面端 Release 到 GitHub Releases
# 用法：
#   export GITHUB_TOKEN=ghp_xxx
#   ./frontend/scripts/push-release.sh [tag]
# 不传 tag 时默认从 frontend/package.json 读取 version 并加 v 前缀。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELEASE_DIR="$ROOT/frontend/release"

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "错误：请设置环境变量 GITHUB_TOKEN（GitHub PAT）"
  exit 1
fi

VERSION=$(node -p "require('$ROOT/frontend/package.json').version")
TAG="${1:-v$VERSION}"
REPO="yangxivi/yingfubao"

echo "准备发布 $TAG 到 github.com/$REPO ..."

# 创建 Release（草稿=false，预发布=false）
RELEASE_JSON=$(curl -sS --ssl-no-revoke -L \
  -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/$REPO/releases" \
  -d "{\"tag_name\":\"$TAG\",\"name\":\"应付宝桌面端 $TAG\",\"body\":\"应付宝 Windows 桌面安装包（NSIS）。安装后自动启用自动更新。\"}")

UPLOAD_URL=$(echo "$RELEASE_JSON" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).upload_url.replace('{?name,label}','')")
RELEASE_ID=$(echo "$RELEASE_JSON" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id")

if [ -z "$UPLOAD_URL" ] || [ "$UPLOAD_URL" = "undefined" ]; then
  echo "创建 Release 失败，返回信息："
  echo "$RELEASE_JSON"
  exit 1
fi

echo "Release 创建成功 (id=$RELEASE_ID)，开始上传资源..."

for FILE in yingfubao-setup-$VERSION.exe yingfubao-setup-$VERSION.exe.blockmap latest.yml; do
  PATH="$RELEASE_DIR/$FILE"
  if [ ! -f "$PATH" ]; then
    echo "跳过缺失文件: $FILE"
    continue
  fi
  echo "上传 $FILE ..."
  curl -sS --ssl-no-revoke -L \
    -X POST \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "Content-Type: application/octet-stream" \
    -T "$PATH" \
    "$UPLOAD_URL?name=$FILE"
  echo " done"
done

echo "全部完成。Release 页面：https://github.com/$REPO/releases/tag/$TAG"
