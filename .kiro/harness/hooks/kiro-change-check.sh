#!/bin/bash
# .kiro/ 配下 (steering / agents / hooks / settings / skills / harness 等) の書き換えを、
# 依頼者の最後の入力に承認の文字列 (既定 [harness-go]) がそれだけの行としてある場合だけ通す
# (PreToolUse, matcher=書き込み系とシェル系)
# 元: mamezou/mamezou-claude-plugins の plugins/harness-ja/hooks/harness-change-check.sh (MIT)
#
# Claude Code 版からの変更点:
#   - 対象を .claude/ から .kiro/ に変えた
#   - 既定の除外を .kiro/specs/ (Spec の requirements / design / tasks) と
#     .kiro/harness/state/ (hook の記録) にした
#   - Kiro の書き込み系ツール (fs_write / fs_append / str_replace / delete_file /
#     smart_relocate / semantic_rename) のパス項目 (path / targetFile / sourcePath /
#     destinationPath) を見る
#   - プラグインからの複製の例外は削った (Kiro 版はリポジトリに直接置くため)
#
# Bash の判定 (Claude Code 版と同じ):
#   - リダイレクト (> / >>) の先が .kiro/ 配下
#   - sed -i / perl -i / tee / mv / rm / rmdir / touch / chmod / chown / truncate の引数に .kiro/ 配下
#   - cp / rsync / install / ln の最後の引数が .kiro/ 配下
#   - git checkout / restore / stash / reset / apply / clean / mv / rm の引数に .kiro/ 配下
#   - python / node / perl / ruby / php の実行と .kiro/ 配下の同居
#   mkdir と読み取り (cat / grep / sed -n / jq) は対象外
#
# 限界: .kiro/ を書かずに触れる形 (cd 後の相対パス、変数展開、git checkout -- .) は止まらない
#
# 設定 (.kiro/harness/config.json):
#   harnessChange.enabled           false で無効化
#   harnessChange.token             承認の文字列 (既定 [harness-go])
#   harnessChange.excludePatterns[] パスに含めば対象外にする文字列

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/config.sh"

input=$(cat)
if ! command -v jq >/dev/null 2>&1; then
  echo "[harness] jq が無いため kiro-change-check を実行できません" >&2
  exit 1
fi
harness_load_config "$input"
harness_config_guard pre
cfg_enabled '.harnessChange' || exit 0

principal=$(harness_principal)
go_token=$(cfg '.harnessChange.token' '[harness-go]')

exclude_patterns=()
while IFS= read -r ex; do
  [[ -n "$ex" ]] && exclude_patterns+=("$ex")
done < <(cfg_list '.harnessChange.excludePatterns[]?')
if [[ ${#exclude_patterns[@]} -eq 0 ]]; then
  exclude_patterns=(".kiro/specs/" ".kiro/harness/state/")
fi

# 除外パスの判定。末尾に / を足して照合する (.kiro/harness/state も .kiro/harness/state/ に一致させる)
is_excluded() {
  local p="$1" ex
  for ex in "${exclude_patterns[@]}"; do
    if printf '%s/' "$p" | grep -qF -- "$ex"; then return 0; fi
  done
  return 1
}

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
kind=$(harness_tool_kind "$tool_name")

target=""
detail=""
case "$kind" in
  write)
    while IFS= read -r file_path; do
      [[ -z "$file_path" ]] && continue
      abs=$(harness_normalize_path "$file_path" "${cwd:-$HARNESS_PROJECT_ROOT}")
      if printf '%s' "$abs" | grep -qE '(^|/)\.kiro/' && ! is_excluded "$abs"; then
        target="$file_path"
        detail="${tool_name}"
        break
      fi
    done < <(harness_tool_paths "$input")
    ;;
  shell)
    command=$(printf '%s' "$input" | jq -r '.tool_input.command // .tool_input.cmd // empty')
    [[ -z "$command" ]] && exit 0
    flat=$(printf '%s' "$command" | tr '\n' ' ')
    paths=""
    while IFS= read -r p; do
      [[ -z "$p" ]] && continue
      is_excluded "$p" || paths="${paths}${p}"$'\n'
    done < <(printf '%s' "$flat" | grep -oE "[^[:space:]\"'\`;|&<>()]*\.kiro/[^[:space:]\"'\`;|&<>()]*" || true)
    [[ -z "${paths//[$'\n' ]/}" ]] && exit 0
    redirect_re=">>?[[:space:]]*[\"']?[^[:space:]\"']*\.kiro/"
    anyarg_re="(^|[[:space:]|;&(])(sed[[:space:]]+(-[a-zA-Z]*i|--in-place)[^|;&]*|perl[[:space:]]+-[a-zA-Z]*i[^|;&]*|(tee|mv|rm|rmdir|touch|chmod|chown|truncate)[[:space:]][^|;&]*|git[[:space:]]+(checkout|restore|stash|reset|apply|clean|mv|rm)[[:space:]][^|;&]*)\.kiro/"
    dest_re="(^|[[:space:]|;&(])(cp|rsync|install|ln)[[:space:]][^|;&]*[^[:space:]|;&]*\.kiro/[^[:space:]|;&]*[[:space:]]*($|[|;&)])"
    interp_re="(^|[[:space:]|;&(])(python[0-9.]*|node|perl|ruby|php)[[:space:]].*\.kiro/"
    # 除外パスだけに触れるコマンドは通す (除外パスを取り除いた文字列で判定する)
    delim="[:space:]\"'\`;|&<>()"
    judged="$flat"
    for ex in "${exclude_patterns[@]}"; do
      ex_re=$(printf '%s' "${ex%/}" | sed 's/[].[\*^$#+?(){}|]/\\&/g')
      judged=$(printf '%s' "$judged" | sed -E "s#[^${delim}]*${ex_re}(/[^${delim}]*)?([${delim}]|\$)#__EXCLUDED__\2#g")
    done
    if printf '%s' "$judged" | grep -qE "$redirect_re" \
      || printf '%s' "$judged" | grep -qE "$anyarg_re" \
      || printf '%s' "$judged" | grep -qE "$dest_re" \
      || printf '%s' "$judged" | grep -qE "$interp_re"; then
      target=$(printf '%s\n' "$paths" | grep -v '^$' | head -1)
      detail="シェルのコマンド ($(printf '%s' "$flat" | sed -E 's/^[[:space:]]*//' | LC_ALL=C.UTF-8 grep -oE '^.{1,60}')...)"
    fi
    ;;
  *) exit 0 ;;
esac
[[ -z "$target" ]] && exit 0

last_user_msg=$(harness_last_user_message "$input")
if harness_has_token "$last_user_msg" "$go_token"; then
  exit 0
fi

exclude_hint=$(printf '%s, ' "${exclude_patterns[@]}" | sed 's/, $//')
cat >&2 <<MSG
[設定・規則ファイルの保護]
.kiro/ 配下 (${target}) を ${detail} で書き換えようとしていますが、
${principal}の最後の入力に ${go_token} だけの行がありません。

手順:
1. 変更の対象と意図の一覧を${principal}に示す
2. ${principal}が ${go_token} だけの行を含むメッセージで承認する
3. その直後に書き換える (次の${principal}の入力までは複数の書き換えが通る)

除外パス (${exclude_hint}) と読み取り (cat / grep / sed -n / jq) は対象外です。
MSG
exit 2
