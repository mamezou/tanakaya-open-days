---
inclusion: always
---

<!-- 元: mamezou/mamezou-claude-plugins の plugins/harness-ja/rules-templates/start-approval.md (MIT)。本プロジェクト向けに短くした -->

# 着手と承認

- 承認として扱うのは、命令形・依頼形の明示の指示（「反映して」「進めて」）と、明示の可否（OK / NG）だけ。疑問形は承認ではない
- 取り消しに手間のかかる操作（コミット、削除、push、PR のマージ、デプロイ、LINE の配信）は、対象を示して確認を得てから行う
- 複数の案を示したときは、承認された項目だけを承認済みとする
- 読んだ資料は「読んだ」、読んでいない資料は「読んでいない」と書く

## hook に止められたとき

| 止める操作 | 通る条件（依頼者が自分のメッセージに、それだけの行で書く） |
|---|---|
| aws と sam の変更系コマンド | `docs/runbooks/` を読んだうえで `[change-go: tanakaya]` |
| `.kiro/` 配下の書き換え（`.kiro/specs/` を除く） | `[harness-go]` |
| 計画を読まずに requirements.md を編集 | 先に `docs/plan.md` を読む |

止められたら、資料を読んでから再実行するか、対象と意図を示して指示を待つ。
