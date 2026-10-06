# デプロイ手順書

田中屋 営業日カレンダーのデプロイと、設定（休業日など）の反映の手順です。

この手順書のコマンドの多くは、`.kiro/harness/` の hook が止めます（`sam deploy`、`aws s3 sync`、`aws cloudfront create-invalidation`、Power の `sam_deploy` など）。エージェントが実行するときは、次の順に進めます。

1. この手順書を読む
2. 実行するコマンド、対象のスタック、影響を依頼者に示す
3. 依頼者が `[change-go: tanakaya]` だけの行を含むメッセージで承認する
4. その直後に実行し、結果を報告する

## スタック

| スタック | 用途 | 前日配信 |
|---|---|---|
| `tanakaya-open-days-test` | 動作確認、デモ | 無効のまま（`NotifyEnabled=false`）。有効にしない |
| `tanakaya-open-days-prod` | お客様向け | 依頼者の指示を受けてから有効にする。有効にすると、LINE の友だち全員に毎日配信される |

設定は `samconfig.toml` の `test` と `prod`。どちらも東京リージョン、プロファイル `mamelabo`。

## 前提

- `aws sso login --profile mamelabo` で AWS にログインしている
- `npm ci` を済ませている
- `data/settings.json` がある。初回は見本から作る：`cp data/settings.example.json data/settings.json`。このファイルは git で管理しない
- チャネルアクセストークンが SSM の SecureString `/tanakaya/prod/line-channel-access-token` にある
- Power（AWS SAM）でデプロイするときは、SAM の MCP サーバーに `--allow-write` が付いている（依頼者が設定する）

## 1. テスト用スタックへのデプロイ（初回と、コードを変えたとき）

### 1.1 ビルド（hook の対象外）

```bash
npm run build                 # build:site（設定の検証と公開ページ）と build:lambda
cat dist/deploy-parameters.txt
sam build --config-env test   # Power なら sam_build
```

`npm run build:site` は、設定に違反があると全件を表示して止まります。直してからやり直します。

### 1.2 デプロイ（承認が要る）

Power の `sam_deploy` を使う場合の引数：

| 引数 | 値 |
|---|---|
| `application_name` | `tanakaya-open-days-test` |
| `project_directory` | リポジトリの絶対パス |
| `config_file` | `<リポジトリの絶対パス>/samconfig.toml` |
| `config_env` | `test` |

CLI の場合：

```bash
sam deploy --config-env test
```

配信時刻（`notifyTime`）が 18:00 以外のときは、`dist/deploy-parameters.txt` の値を足して、パラメータをすべて渡します（`parameter_overrides` は samconfig.toml の値を置き換えるため）。

```bash
sam deploy --config-env test --parameter-overrides 'NotifyEnabled=false LineTokenParameterName=/tanakaya/prod/line-channel-access-token NotifyScheduleExpression="cron(30 17 * * ? *)"'
```

### 1.3 スタックの出力を確かめる（hook の対象外）

```bash
aws cloudformation describe-stacks --stack-name tanakaya-open-days-test --profile mamelabo \
  --query "Stacks[0].Outputs" --output table
```

`SiteBucketName`、`DistributionId`、`SiteUrl` を控え、`NotifyEnabled` が `false` であることを確かめます。

### 1.4 公開ページを反映する（承認が要る）

```bash
aws s3 sync dist/site s3://<SiteBucketName> --delete --cache-control "public, max-age=300" --profile mamelabo
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*" --profile mamelabo
```

### 1.5 確かめる

- `SiteUrl` を開き、今日の営業、営業時間、今月と来月のカレンダー、LINE と Instagram のリンクが出る
- スマートフォンの幅（360px）で横にスクロールしない
- 前日配信の起動が無効のまま（hook の対象外）

```bash
aws scheduler list-schedules --profile mamelabo --region ap-northeast-1 \
  --query "Schedules[?contains(Name, 'tanakaya-open-days-test')].[Name,State]" --output table
```

スケジュールの名前は `<スタック名>-notify`。2026-10-06 の初回デプロイのテスト用スタックだけは、名前を付ける前のテンプレートで作ったため `NotifyFunctionNotifySchedule` になっている（次のデプロイで `tanakaya-open-days-test-notify` に置き換わる）。

`State` が `DISABLED` であること。

## 2. 設定だけを変えるとき（休業日、臨時営業日、営業曜日、営業時間）

提出後のコミット禁止期間にも、この手順で反映できます。git は使いません。

1. 今の設定を git の外に控える：`cp data/settings.json ~/tanakaya-settings-$(date +%Y%m%d%H%M).json`
2. `data/settings.json` を書き換える
3. `npm run build:site`
4. 1.4 の `aws s3 sync` と `create-invalidation` を実行する（承認が要る）
5. 公開ページで、変えた日の表示を確かめる

前日配信は S3 の `calendar.json` を読むので、本番スタックの配信も 4 の時点で新しい設定になります。

配信時刻（`notifyTime`）を変えたときは、1 の手順をすべて行います（起動の時刻はスタックのパラメータのため）。

すでに配信した日の訂正は、自動では再配信しません。LINE Official Account Manager から手で送ります。

## 3. 本番スタック（提出後。依頼者の指示があるときだけ）

1 と同じ手順で、`config_env` を `prod`、スタック名を `tanakaya-open-days-prod` にします。

前日配信を有効にするときは、次を確かめてから `NotifyEnabled=true` でデプロイします。

- `line-tester` で依頼者宛てに試験送信し、文面を確かめた
- `get_message_quota` で、その月の残りの通数が足りる
- 最初の配信の日時と、案内の種類（通常営業、臨時休業、臨時営業）を依頼者に示した

```bash
sam deploy --config-env prod --parameter-overrides 'NotifyEnabled=true LineTokenParameterName=/tanakaya/prod/line-channel-access-token NotifyScheduleExpression="cron(0 18 * * ? *)"'
```

## 4. 戻し方

| 戻したいもの | 方法 |
|---|---|
| 設定（公開ページと配信の内容） | 控えた設定を `data/settings.json` に戻し、2 の手順で反映する。急ぐときは S3 のバージョニングで `calendar.json` の前の版に戻せる（`aws s3api list-object-versions --bucket <SiteBucketName> --prefix calendar.json`） |
| 前日配信を止める | `NotifyEnabled=false` でデプロイする（承認が要る） |
| コードやテンプレート | 前のコミットに戻し、1 の手順でデプロイする |
| テスト用スタックを消す | バケットを空にしてから（バージョンも含む）`sam delete --config-env test`（承認が要る） |

## してはいけないこと

- 前日配信の関数を手で動かす（`sam local invoke`、`sam local start-lambda`、`sam remote invoke`、`aws lambda invoke`、Power の `sam_local_invoke`）。本番のトークンで友だち全員に配信される。hook が止める
- テスト用スタックで前日配信を有効にする
- トークンをコマンドの引数、ファイル、チャットに書く
- 配信の失敗やタイムアウトのあとに、手で再送する
