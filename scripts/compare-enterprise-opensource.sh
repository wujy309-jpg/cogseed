#!/usr/bin/env bash
# 企业版（GitLab）vs 开源版（GitHub）分支对比
#
# 只读脚本：只做 fetch 与 diff，不 push、不 checkout、不改工作区。
# 用法：
#   bash scripts/compare-enterprise-opensource.sh                    # develop-ent vs public/develop
#   bash scripts/compare-enterprise-opensource.sh <企业分支> <开源分支>
#
# 环境变量：
#   ENT_REMOTE  企业远端名（默认 gitlab）
#   OSS_REMOTE  开源远端名（默认 public）
#   PRIV_REMOTE 私仓远端名（默认 origin；企业版历史上真实同步源，见对比报告 §3）
set -uo pipefail

ENT_REMOTE="${ENT_REMOTE:-gitlab}"
OSS_REMOTE="${OSS_REMOTE:-public}"
PRIV_REMOTE="${PRIV_REMOTE:-origin}"
ENT_BRANCH="${1:-develop-ent}"
OSS_BRANCH="${2:-develop}"
PRIV_BRANCH="${PRIV_BRANCH:-develop}"

ENT_REF="refs/remotes/${ENT_REMOTE}/${ENT_BRANCH}"
OSS_REF="refs/remotes/${OSS_REMOTE}/${OSS_BRANCH}"
PRIV_REF="refs/remotes/${PRIV_REMOTE}/${PRIV_BRANCH}"

say() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }

say "1. 拉取最新 refs（只读；会移动远端跟踪引用）"
for r in "$ENT_REMOTE" "$OSS_REMOTE" "$PRIV_REMOTE"; do
  if git fetch "$r" '+refs/heads/*:refs/remotes/'"$r"'/*' --no-tags --quiet; then
    echo "✓ $r"
  else
    echo "✗ $r fetch 失败（跳过该远端）" >&2
  fi
done

say "2. 分支基线"
for b in "$ENT_REF" "$OSS_REF" "$PRIV_REF"; do
  git rev-parse --verify --quiet "$b" >/dev/null || { echo "$b 不存在，跳过"; continue; }
  printf '%-30s %s  %s\n' "$b" "$(git rev-parse --short=8 "$b")" "$(git log -1 --format=%ci "$b")"
done

# 同源性 + 双向计数；$1=左ref $2=右ref $3=标签
compare_pair() {
  local left="$1" right="$2" label="$3"
  git rev-parse --verify --quiet "$left" >/dev/null || return 0
  git rev-parse --verify --quiet "$right" >/dev/null || return 0
  say "$label"
  local mb; mb="$(git merge-base "$left" "$right" 2>/dev/null)"
  if [ -z "$mb" ]; then
    echo "⚠ 无共同祖先 —— 非同源；文件级 diff 仅能做树对比，不能读提交增量"
    git diff --shortstat "$right" "$left"
    return 0
  fi
  local lroot rroot
  lroot="$(git rev-list --max-parents=0 "$left" | head -1)"
  rroot="$(git rev-list --max-parents=0 "$right" | head -1)"
  printf 'merge-base : %s  %s\n' "${mb:0:8}" "$(git log -1 --format='%ci %s' "$mb" | cut -c1-60)"
  printf '根提交     : 左 %s / 右 %s  %s\n' "${lroot:0:8}" "${rroot:0:8}" \
    "$([ "$lroot" = "$rroot" ] && echo '✓ 同源' || echo '⚠ 不同根')"
  printf '左侧独有   : %s（去 merge %s）\n' \
    "$(git rev-list --count "$mb..$left")" "$(git rev-list --no-merges --count "$mb..$left")"
  printf '右侧独有   : %s（去 merge %s）\n' \
    "$(git rev-list --count "$mb..$right")" "$(git rev-list --no-merges --count "$mb..$right")"
  echo "--- 树级差异 ---"
  git diff --shortstat "$right" "$left"
}

compare_pair "$ENT_REF" "$OSS_REF" "3. 企业版 vs 开源公仓（${OSS_REF}）"
compare_pair "$ENT_REF" "$PRIV_REF" "4. 企业版 vs 私仓（${PRIV_REF}）—— 历史真实同步源"

say "5. 企业侧独有提交（相对私仓，最近 30；去 merge）"
if git rev-parse --verify --quiet "$PRIV_REF" >/dev/null; then
  git log --oneline --no-merges "$ENT_REF" --not "$PRIV_REF" | head -30
fi

say "6. 同步合并提交（merge: 同步上游 / sync-upstream）"
echo "以下为实际发生在企业主线上的上游同步合并，比 sync/upstream-* 标记可靠："
git log --merges --format='  %h %ci %s' "$ENT_REF" 2>/dev/null \
  | grep -iE "同步上游|sync/upstream|同步最新 develop" | head -10

say "7. sync/upstream-* 标记有效性（上游 force-push 后常失效）"
for b in $(git for-each-ref --format='%(refname:short)' "refs/remotes/${ENT_REMOTE}/sync/" 2>/dev/null); do
  sha="$(git rev-parse "$b")"
  printf '%-18s 私仓 %-4s 开源 %-4s 企业主线 %-4s\n' "${b##*/}" \
    "$(git merge-base --is-ancestor "$sha" "$PRIV_REF" 2>/dev/null && echo YES || echo NO)" \
    "$(git merge-base --is-ancestor "$sha" "$OSS_REF" 2>/dev/null && echo YES || echo NO)" \
    "$(git merge-base --is-ancestor "$sha" "$ENT_REF" 2>/dev/null && echo YES || echo NO)"
done

say "8. 变更文件按目录分布（Top 20，企业 vs 开源）"
git diff --name-only "$OSS_REF" "$ENT_REF" \
  | awk -F/ '{if(NF>1) print $1"/"$2; else print "(root) "$1}' \
  | sort | uniq -c | sort -rn | head -20

say "完成（全程只读，未推送任何远端）"
