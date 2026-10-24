---
name: safe-announce
description: LINE 公式アカウントで告知する前に、通数の上限、依頼者宛ての試験送信、文面の確認を順に行う安全な配信手順。「LINE で告知」「LINE の試験送信」「LINE の通数」等のリクエストで使う。
---

# LINE の安全な配信手順

LINE の配信は取り消せない。友だち全員への配信（broadcast）は、送った瞬間に実際のお客様に届く。この手順では、エージェントは依頼者宛ての push だけを行い、友だち全員への配信はしない。

## 前提

- トークンと宛先（依頼者のユーザー ID）は、AWS SSM Parameter Store の SecureString に置く。既定の名前は次のとおりで、環境変数で変えられる
  - `LINE_TOKEN_PARAMETER`（既定 `/tanakaya/prod/line-channel-access-token`）
  - `LINE_DESTINATION_PARAMETER`（既定 `/tanakaya/prod/line-destination-user-id`）
- MCP サーバーは、起動のたびに SSM から2つを読んで環境変数で渡す（`mcp.json`）。トークンをファイルに書かない
- AWS の認証は `aws sso login` で用意する（既定のプロファイルは `AWS_PROFILE=mamelabo`）
- 本プロジェクトでは `.kiro/harness/hooks/line-send-check.sh` が、broadcast 系のツールと `userId` 付きの push を止める

## Step 1：通数の確認

`get_message_quota` で、その月の上限と使用数を取得して依頼者に示す。

- 無料プランの上限は月200通
- push は1通、友だち全員への配信は友だちの人数分を数える
- 残りが、これから送る通数（試験送信1通 + 本番の告知の人数分）より少なければ、送らずに依頼者に相談する

## Step 2：文面の確認

送る文面を依頼者に示し、送ってよいか指示を待つ。

- 試験送信の文面の先頭には「【試験送信】」を付ける
- 告知に入れてよいのは、日付、曜日、営業可否、営業時間、予約の方法、田中屋のホームページと Instagram の URL。運用者の個人情報やメモは入れない
- 「確認しました」「大丈夫そう」は送る指示ではない。「送って」などの明示の指示を待つ

## Step 3：依頼者宛ての試験送信

`push_text_message`（または `push_flex_message`）を1回だけ使う。

- `userId` は指定しない。既定の宛先（依頼者）に届く
- 失敗やタイムアウトのあとに再送しない。タイムアウトは届いている可能性がある。結果を報告して判断を待つ
- 依頼者に、スマートフォンで表示を確かめてもらう

## Step 4：本番の告知

友だち全員への告知は、エージェントからは行わない。次のどちらかで行う。

- 定例の告知：アプリの前日配信（本番スタックで配信を有効にしたもの）に任せる
- 訂正や臨時の告知：依頼者が LINE Official Account Manager から手で送る。Step 2 と Step 3 で確かめた文面を使う

## やってはいけないこと

- broadcast、multicast、narrowcast のツールを使う
- `userId` を指定して、依頼者以外に push する
- トークンやユーザー ID をチャット、ファイル、ログ、コミットに書く
- 前日配信の関数を手で動かす（`sam local invoke`、`aws lambda invoke` など）。本番のトークンで友だち全員に届く
