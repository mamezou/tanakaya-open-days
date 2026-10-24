#!/bin/bash
# aws / sam / cdk / az の変更系コマンドを、手順書の読み取りと承認の文字列の下でのみ通す
# (PreToolUse, matcher=シェル系)
# 元: mamezou/mamezou-claude-plugins の plugins/harness-ja/hooks/cloud-change-check.sh (MIT)
#
# Claude Code 版からの変更点:
#   - transcript の代わりに record-prompt.sh / record-read.sh の記録を使う
#   - sam を追加した。deploy / delete / sync / package / publish / remote invoke /
#     remote test-event put|delete / pipeline bootstrap / local invoke / local start-lambda を
#     変更系とする（local の2つは、本番のトークンで友だち全員に配信しうるため）
#     (build / validate / local generate-event / local start-api / logs / list / traces / init は
#     対象外)
#   - aws のグローバルオプション (--profile x、--region x 等) を読み飛ばしてから
#     <サービス> <操作> を取る (Claude Code 版では aws --profile x s3 rm を見逃していた)
#   - 本プロジェクト向けに aws の変更系を追加した
#       lambda invoke / invoke-async   配信用 Lambda を起動すると LINE の配信が走るため
#       publish / send-*               SNS・SQS・SES への送信
#       batch-write-item / transact-write-items / execute-statement 等   DynamoDB の書き込み
#       admin-* (admin-get-* / admin-list-* を除く)   Cognito の利用者操作
#       execute-change-set / set-* / reset-* / restore-* / import-* / upload-*
#
# 通過条件 (両方満たす、またはバイパスあり):
#   (A) readWindowMinutes (既定 180 分) 以内に runbookPattern に一致するファイルを読み取った
#   (B) 依頼者の最後の入力に [change-go: <name>] がそれだけの行としてある
# バイパス: 依頼者の最後の入力に [hook-bypass: cloud-change] がそれだけの行としてある
#
# 限界:
#   - 文字列の形で判定する。変数展開やスクリプト経由の実行 (bash deploy.sh) は止まらない
#
# 設定 (.kiro/harness/config.json):
#   cloudChange.enabled     false で無効化
#   cloudChange.projects[]  name / clis[] / cwdMatch / runbookPattern / runbookHint / guideRef

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/config.sh"

input=$(cat)
if ! command -v jq >/dev/null 2>&1; then
  echo "[harness] jq が無いため cloud-change-check を実行できません" >&2
  exit 1
fi
harness_load_config "$input"
harness_config_guard pre
cfg_enabled '.cloudChange' || exit 0

project_count=$(cfg '.cloudChange.projects | length' '0')
[[ "${project_count:-0}" -gt 0 ]] || exit 0

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
[[ -z "$tool_name" || "$(harness_tool_kind "$tool_name")" == "shell" ]] || exit 0

principal=$(harness_principal)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
command=$(printf '%s' "$input" | jq -r '.tool_input.command // .tool_input.cmd // empty')
[[ -n "$command" ]] || exit 0

# 単独の az config / az account set は除外 (ローカル CLI 設定のみ)
if ! printf '%s' "$command" | grep -qE '[;&|]'; then
  if printf '%s' "$command" | grep -qE '^[[:space:]]*az[[:space:]]+(config[[:space:]]+|account[[:space:]]+set([[:space:]]|$))'; then
    exit 0
  fi
fi

az_change=0; aws_change=0; sam_change=0; cdk_change=0
az_change_verbs='create|update|delete|set|assign|add|remove|restart|start|stop|enable|disable|import|invoke-action'

trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

# 断片の先頭から sudo・環境変数の代入・env / command を取り除く
strip_prefix_words() {
  local s w allow_opts=0
  s=$(trim "$1")
  while [[ -n "$s" ]]; do
    w="${s%%[[:space:]]*}"
    if [[ "$w" != -* && "$w" == *=* ]]; then s=$(trim "${s#"$w"}"); continue; fi
    if [[ "$w" == sudo || "$w" == env || "$w" == command || "$w" == exec || "$w" == time ]]; then
      s=$(trim "${s#"$w"}"); allow_opts=1; continue
    fi
    if [[ "$allow_opts" -eq 1 && "$w" == -* ]]; then s=$(trim "${s#"$w"}"); continue; fi
    break
  done
  printf '%s' "$s"
}

# aws のグローバルオプションを読み飛ばし、<サービス> <操作> を 1 行で返す
aws_service_op() {
  local t skip=0 words=() toks=()
  read -ra toks <<< "$1" || true
  for t in "${toks[@]}"; do
    if [[ "$skip" -eq 1 ]]; then skip=0; continue; fi
    if [[ "$t" == --* ]]; then
      case "$t" in
        *=*) ;;
        --debug|--no-verify-ssl|--no-paginate|--no-sign-request|--no-cli-pager|--no-cli-auto-prompt|--cli-auto-prompt|--version) ;;
        *) skip=1 ;;
      esac
      continue
    fi
    [[ "$t" == -* ]] && continue
    words+=("$t")
    (( ${#words[@]} >= 2 )) && break
  done
  printf '%s %s' "${words[0]:-}" "${words[1]:-}"
}

is_aws_change() { # is_aws_change <service> <op>
  local svc="$1" op="$2"
  if [[ "$svc" == s3 ]]; then
    case "$op" in sync|cp|mv|rm|rb|mb) return 0 ;; esac
  fi
  case "$op" in
    admin-get-*|admin-list-*) return 1 ;;
    deploy|invoke|invoke-async|publish|publish-*|send-*) return 0 ;;
    create-*|update-*|delete-*|put-*|modify-*|attach-*|detach-*|add-*|remove-*) return 0 ;;
    register-*|deregister-*|start-*|stop-*|enable-*|disable-*) return 0 ;;
    associate-*|disassociate-*|revoke-*|authorize-*|tag-*|untag-*) return 0 ;;
    run-instances|terminate-instances|reboot-instances) return 0 ;;
    batch-write-item|transact-write-items|execute-statement|batch-execute-statement) return 0 ;;
    execute-change-set|admin-*|set-*|reset-*|restore-*|import-*|upload-*) return 0 ;;
  esac
  return 1
}

is_sam_change() { # is_sam_change <sam の後ろの文字列>
  local t words=() toks=()
  read -ra toks <<< "$1" || true
  for t in "${toks[@]}"; do
    [[ "$t" == -* ]] && continue
    words+=("$t")
    (( ${#words[@]} >= 3 )) && break
  done
  case "${words[0]:-}" in
    deploy|delete|sync|package|publish) return 0 ;;
    local)
      # 関数を実際に動かすもの。本番のトークンで友だち全員に配信しうる（line-messaging.md）
      [[ "${words[1]:-}" == invoke || "${words[1]:-}" == start-lambda ]] && return 0
      ;;
    remote)
      [[ "${words[1]:-}" == invoke ]] && return 0
      [[ "${words[1]:-}" == test-event && ( "${words[2]:-}" == put || "${words[2]:-}" == delete ) ]] && return 0
      ;;
    pipeline) [[ "${words[1]:-}" == bootstrap ]] && return 0 ;;
  esac
  return 1
}

# コマンド行を制御演算子と改行で分割し、各断片の先頭語だけを CLI とみなす
while IFS= read -r seg; do
  seg=$(strip_prefix_words "$seg")
  [[ -z "$seg" ]] && continue
  head_word="${seg%%[[:space:]]*}"
  if [[ "$head_word" == npx || "$head_word" == pnpx || "$head_word" == bunx ]]; then
    seg=$(trim "${seg#"$head_word"}")
    while [[ -n "$seg" && "${seg%%[[:space:]]*}" == -* ]]; do
      head_word="${seg%%[[:space:]]*}"
      seg=$(trim "${seg#"$head_word"}")
    done
  fi
  first="${seg%%[[:space:]]*}"
  head_word="${first##*/}"   # /usr/local/bin/aws のような絶対パス指定も拾う
  rest=$(trim "${seg#"$first"}")

  case "$head_word" in
    az)
      az_prefix=$(printf '%s' "$rest" | awk '{for (i=1; i<=NF; i++) { if ($i ~ /^--/) break; printf "%s ", $i }}')
      if printf ' %s ' "$az_prefix" | grep -qE "[[:space:]](${az_change_verbs})[[:space:]]"; then az_change=1; fi
      if printf '%s' "$rest" | grep -qiE '^rest([[:space:]]|$).*(--method|-m)([[:space:]]+|=)(put|post|patch|delete)([[:space:]]|$)'; then az_change=1; fi
      ;;
    aws)
      read -r svc op <<< "$(aws_service_op "$rest")" || true
      if is_aws_change "${svc:-}" "${op:-}"; then aws_change=1; fi
      ;;
    sam)
      if is_sam_change "$rest"; then sam_change=1; fi
      ;;
    cdk)
      skip_next=0
      while IFS= read -r t; do
        [[ -z "$t" ]] && continue
        if [[ "$t" == -* ]]; then
          if [[ "$t" == *=* ]]; then skip_next=0; else skip_next=1; fi
          continue
        fi
        if [[ "$skip_next" -eq 1 ]]; then skip_next=0; continue; fi
        case "$t" in deploy|destroy|bootstrap|watch) cdk_change=1 ;; esac
      done < <(printf '%s\n' "$rest" | tr -s '[:space:]' '\n')
      ;;
  esac
done < <(printf '%s\n' "$command" | tr ';|&()' '\n')

if [[ "$az_change" -eq 0 && "$aws_change" -eq 0 && "$sam_change" -eq 0 && "$cdk_change" -eq 0 ]]; then
  exit 0
fi

detected_clis=""
[[ "$az_change" -eq 1 ]] && detected_clis="${detected_clis} az"
[[ "$aws_change" -eq 1 ]] && detected_clis="${detected_clis} aws"
[[ "$sam_change" -eq 1 ]] && detected_clis="${detected_clis} sam"
[[ "$cdk_change" -eq 1 ]] && detected_clis="${detected_clis} cdk"
detected_cmd=$(printf '%s' "$command" | head -1 | sed -E 's/^[[:space:]]*//' | awk '{print $1, $2, $3, $4}')

# 案件判定 (projects[] の配列順に最初の一致を採用。cwdMatch はパス区切り単位で照合)
cwd_norm=$(printf '%s' "${cwd:-$HARNESS_PROJECT_ROOT}" | sed -E 's#/+#/#g; s#/$##')
cwd_matches() {
  local m="$1"
  [[ "$cwd_norm" == */"$m" || "$cwd_norm" == */"$m"/* || "$command" == *"/$m/"* ]]
}

project=""; runbook_pattern=""; runbook_hint=""; guide_ref=""
while IFS= read -r proj; do
  [[ -z "$proj" ]] && continue
  name=$(printf '%s' "$proj" | jq -r '.name // empty')
  [[ -z "$name" ]] && continue
  cli_hit=0
  while IFS= read -r c; do
    [[ -n "$c" && " ${detected_clis} " == *" $c "* ]] && cli_hit=1
  done < <(printf '%s' "$proj" | jq -r '.clis[]?')
  [[ "$cli_hit" -eq 1 ]] || continue
  cwd_match=$(printf '%s' "$proj" | jq -r '.cwdMatch // empty')
  if [[ -n "$cwd_match" ]] && ! cwd_matches "$cwd_match"; then continue; fi
  project="$name"
  runbook_pattern=$(printf '%s' "$proj" | jq -r '.runbookPattern // empty')
  runbook_hint=$(printf '%s' "$proj" | jq -r '.runbookHint // empty')
  guide_ref=$(printf '%s' "$proj" | jq -r '.guideRef // empty')
  break
done < <(cfg_list '.cloudChange.projects[]? | @json')

if [[ -z "$project" ]]; then
  cat >&2 <<MSG
[クラウド変更コマンドの停止]
変更系コマンド (${detected_cmd}...) を検知しましたが、設定のどの案件にも一致しません。
検出した CLI:${detected_clis} / cwd: ${cwd_norm}

設定不足: .kiro/harness/config.json の cloudChange.projects[] に案件を追加してください。
MSG
  exit 2
fi

[[ -n "$runbook_pattern" ]] || runbook_pattern='runbook.*\.md'
[[ -n "$runbook_hint" ]] || runbook_hint='ファイル名に runbook を含む .md'
[[ -n "$guide_ref" ]] || guide_ref='クラウド変更の手順'
go_token="[change-go: ${project}]"

last_user_msg=$(harness_last_user_message "$input")
if harness_has_token "$last_user_msg" '[hook-bypass: cloud-change]'; then
  exit 0
fi

has_go=0
harness_has_token "$last_user_msg" "$go_token" && has_go=1

has_runbook=0
if harness_read_paths "$input" | grep -qE -- "$runbook_pattern"; then
  has_runbook=1
fi

if [[ "$has_go" -eq 1 && "$has_runbook" -eq 1 ]]; then
  exit 0
fi

missing=""
[[ "$has_runbook" -eq 0 ]] && missing="${missing}  - 直近で手順書 (${runbook_hint}) を読み取っていない"$'\n'
[[ "$has_go" -eq 0 ]] && missing="${missing}  - ${principal}の最後の入力に ${go_token} だけの行が無い"$'\n'

cat >&2 <<MSG
[クラウド変更コマンドの停止]
変更系コマンド (${detected_cmd}...) を実行しようとしていますが、次の条件を満たしていません。
${missing}
${guide_ref}の手順:
1. 手順書を読み取る (${runbook_hint})
2. 実行するコマンドと影響範囲を${principal}に示す
3. ${principal}が ${go_token} だけの行を含むメッセージで承認する
4. その直後に変更コマンドを実行する

読み取り専用のコマンド (list / get / describe、sam build / validate / logs、cdk synth / diff) は対象外です。
緊急時のみ、${principal}が [hook-bypass: cloud-change] だけの行を書くことで回避できます。
MSG
exit 2
