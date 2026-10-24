#!/bin/bash
# Power（MCP）のツールによるクラウドの変更を、手順書の読み取りと承認の文字列の下でのみ通す
# (PreToolUse, matcher=kiro_powers と @ で始まる MCP ツール)
#
# cloud-change-check.sh はシェルのコマンドの文字列を見るため、Power のツールで
# デプロイするとシェルを通らずに止まらない。本 hook はツール名で判定して止める。
#
# 判定するツール:
#   - tool_name が kiro_powers（表記ゆれを含む）で、tool_input.action が use のとき、
#     tool_input.toolName
#   - tool_name が @ で始まる MCP ツールのとき、最後の / より後ろ
#   上のツール名が cloudChange.powerTools[] のどれかと一致すれば変更系とみなす
#   既定は AWS SAM Power（awslabs.aws-serverless-mcp-server 0.2.0）の次のツール:
#     sam_deploy / deploy_webapp / update_webapp_frontend / configure_domain
#       クラウドを変える（--allow-write が要る）
#     esm_guidance / esm_optimize / esm_kafka_troubleshoot
#       README で変更系に分類されている（テンプレートを作り、sam_deploy と組み合わせる）
#     sam_local_invoke
#       ローカル実行だが、設定によっては本番の LINE に配信しうる（line-messaging.md）
#     update_frontend
#       README の旧名。今のツール名は update_webapp_frontend
#   sam_build / sam_init / sam_logs / get_metrics / スキーマとガイドの取得は対象外
#
# 通過条件 (両方満たす、またはバイパスあり):
#   (A) readWindowMinutes 以内に、cloudChange.powerProject の案件の runbookPattern に
#       一致するファイルを読み取った
#   (B) 依頼者の最後の入力に [change-go: <案件>] がそれだけの行としてある
# バイパス: 依頼者の最後の入力に [hook-bypass: cloud-change] がそれだけの行としてある
#
# 確認用の記録: 判定したツール呼び出しの tool_name / action / toolName だけを
#   state/power-calls.log に残す（引数は残さない）
#
# 設定 (.kiro/harness/config.json):
#   cloudChange.enabled        false で無効化
#   cloudChange.powerProject   使う案件の name（既定は projects[] の最初の要素）
#   cloudChange.powerTools[]   変更系とみなすツール名

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/config.sh"

input=$(cat)
if ! command -v jq >/dev/null 2>&1; then
  echo "[harness] jq が無いため power-change-check を実行できません" >&2
  exit 1
fi
harness_load_config "$input"
harness_config_guard pre
cfg_enabled '.cloudChange' || exit 0

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty')
normalized=$(printf '%s' "$tool_name" | tr '[:upper:]' '[:lower:]' | tr -d '_-')

invoked=""
action=""
if [[ "$normalized" == "kiropowers" ]]; then
  action=$(printf '%s' "$input" | jq -r '.tool_input.action // empty')
  [[ "$action" == "use" ]] && invoked=$(printf '%s' "$input" | jq -r '.tool_input.toolName // empty')
elif [[ "$tool_name" == @* ]]; then
  invoked="${tool_name##*/}"
fi

# 確認用の記録（ツール名だけ）
mkdir -p "$HARNESS_STATE_DIR" 2>/dev/null && chmod 700 "$HARNESS_STATE_DIR" 2>/dev/null || true
( umask 077; printf '%s\t%s\t%s\t%s\n' "$(date +%s)" "$tool_name" "$action" "$invoked" >> "$HARNESS_STATE_DIR/power-calls.log" ) 2>/dev/null || true

[[ -n "$invoked" ]] || exit 0

guarded=()
while IFS= read -r t; do
  [[ -n "$t" ]] && guarded+=("$t")
done < <(cfg_list '.cloudChange.powerTools[]?')
if [[ ${#guarded[@]} -eq 0 ]]; then
  guarded=(sam_deploy sam_local_invoke deploy_webapp update_webapp_frontend update_frontend configure_domain esm_guidance esm_optimize esm_kafka_troubleshoot)
fi

hit=0
for t in "${guarded[@]}"; do
  [[ "$invoked" == "$t" ]] && hit=1
done
[[ "$hit" -eq 1 ]] || exit 0

principal=$(harness_principal)
project=$(cfg '.cloudChange.powerProject' "$(cfg '.cloudChange.projects[0].name' '')")
proj=$(cfg_list ".cloudChange.projects[]? | select(.name == \"${project}\") | @json" | head -1)
if [[ -z "$project" || -z "$proj" ]]; then
  cat >&2 <<MSG
[クラウド変更の停止]
Power のツール ${invoked} を検知しましたが、設定の案件が見つかりません。
設定不足: .kiro/harness/config.json の cloudChange.powerProject と projects[] を確かめてください。
MSG
  exit 2
fi
runbook_pattern=$(printf '%s' "$proj" | jq -r '.runbookPattern // empty')
runbook_hint=$(printf '%s' "$proj" | jq -r '.runbookHint // empty')
[[ -n "$runbook_pattern" ]] || runbook_pattern='runbook.*\.md'
[[ -n "$runbook_hint" ]] || runbook_hint='ファイル名に runbook を含む .md'
go_token="[change-go: ${project}]"

last_user_msg=$(harness_last_user_message "$input")
if harness_has_token "$last_user_msg" '[hook-bypass: cloud-change]'; then
  exit 0
fi

has_go=0
harness_has_token "$last_user_msg" "$go_token" && has_go=1
has_runbook=0
harness_read_paths "$input" | grep -qE -- "$runbook_pattern" && has_runbook=1

if [[ "$has_go" -eq 1 && "$has_runbook" -eq 1 ]]; then
  exit 0
fi

missing=""
[[ "$has_runbook" -eq 0 ]] && missing="${missing}  - 直近で手順書 (${runbook_hint}) を読み取っていない"$'\n'
[[ "$has_go" -eq 0 ]] && missing="${missing}  - ${principal}の最後の入力に ${go_token} だけの行が無い"$'\n'

cat >&2 <<MSG
[クラウド変更の停止]
Power のツール ${invoked} でクラウドを変更しようとしていますが、次の条件を満たしていません。
${missing}
手順:
1. 手順書を読み取る (${runbook_hint})
2. 実行する操作と影響範囲を${principal}に示す
3. ${principal}が ${go_token} だけの行を含むメッセージで承認する
4. その直後に実行する

緊急時のみ、${principal}が [hook-bypass: cloud-change] だけの行を書くことで回避できます。
MSG
exit 2
