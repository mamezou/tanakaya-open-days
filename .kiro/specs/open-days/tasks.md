# 実装計画：田中屋 営業日カレンダー

状態：確定（2026-10-05）

締切は 2026-10-06 15:59（日本時間）。そこから逆算し、7つのレッスンとボーナス2つの実演に要るものから順に並べた。各段階の時刻は「遅くとも終える時刻」の目安。

- 【承認】：`.kiro/` 配下の書き換え、コミットと push、デプロイ、LINE の配信を含む。着手前に依頼者の承認が要る
- 【依頼者】：依頼者が行う作業
- 【クラウドセッション】：Kiro Web のクラウドセッションで実装する（ボーナス1）
- `*` 付き：時間が足りなければ削る
- 段階ごとに feature ブランチを作り、PR にする。マージは依頼者の指示を受けてから

時間が足りないときは、8 → 3.5 → 6.2 の順に削る。配信の動作は、3.3 の試験送信（依頼者宛ての push）と P5 のテストで示す。

LINE 公式アカウントは本番の1つだけを使い、テスト用アカウントは作らない（2026-10-06 に決定）。友だち全員への配信は本番スタックの前日配信だけが行い、エージェントからは行わない（`.kiro/steering/line-messaging.md`）。

- [ ] 1. 段階1：Spec の PR、開発の土台、Power の導入（レッスン1、2、3、5。遅くとも 10/6 01:00）
  - [x] 1.1 【承認】Spec、計画、steering の変更を PR にしてマージする
    - `feature/spec` の requirements、design、tasks、`docs/plan.md`、steering 3本をコミットし、`main` 向けの PR を出す
    - _レッスン：1、2_
  - [x] 1.2 プロジェクトの土台を作る
    - `package.json`（`"type": "module"`、scripts は `test`、`typecheck`、`lint`、`format:check`、`build:site`）と `tsconfig.json`（`strict: true`）
    - devDependencies は TypeScript、Vitest、fast-check、ESLint（flat config）、typescript-eslint、Prettier、esbuild、tsx、@types/node、@types/aws-lambda。バージョンは固定する
    - `.gitignore` に `dist/` を足す
    - `npx vitest run`、`npx tsc --noEmit`、`npx eslint .` が通ることを確かめる
    - _要件：共通の制約_
  - [x] 1.3 【承認】hooks を作り、テンプレートの古い hook を消す
    - Kiro の公式ドキュメントでトリガーの種類を確かめてから作る
    - `src/` 配下の `.ts` の保存時に `npx vitest run` を実行する（単体テストとプロパティベーステスト）
    - `.kiro/specs/*/requirements.md` の保存時に、design と tasks への影響をエージェントに確かめさせる。直すのは依頼者の指示を受けてから
    - `auto-test.kiro.hook` と `auto-commit.kiro.hook` を消す（IDE 1.0 では動かない古い形式。自動コミットは承認のルールと合わない）
    - _レッスン：3_
  - [x] 1.4 【承認】AWS SAM の Power を導入する
    - 結果：`aws-sam` Power を導入。MCP サーバー（awslabs.aws-serverless-mcp-server 0.2.0）は `--with botocore[crt]`、`AWS_PROFILE=mamelabo`、`AWS_REGION=ap-northeast-1` で起動する。`--allow-write` は 5.4 の直前まで付けない
    - 段階5での使い方：ビルドは `sam_build`、デプロイは `sam_deploy`、ログの確認は `sam_logs`。テンプレートの検証は `sam validate --lint` と `aws-infrastructure-as-code` Power の検証ツール。公開ページの S3 への反映は `aws s3 sync`（`update_webapp_frontend` は `deploy_webapp` で作ったプロジェクト向けのため使わない）
    - hook の対象：`sam_deploy`、`sam_local_invoke`、`deploy_webapp`、`update_webapp_frontend`、`configure_domain`、`esm_guidance`、`esm_optimize`、`esm_kafka_troubleshoot`
    - レジストリで AWS SAM の Power を探して導入する。見つからないときは、依頼者に報告して判断を仰ぐ
    - 導入した Power のツールを一覧にし、段階5のどこで使うかを決める（テンプレートの作成、検証、デプロイ）
    - Power のツールでのデプロイはシェルを通らないため、今の hook（`cloud-change-check.sh`）では止まらない。そのツールにも、手順書の読み取りと承認を求める hook を足す
    - 導入の手順を README（6.1）に書けるよう残す
    - _要件：7.3。レッスン：5_
  - [ ] 1.5 【依頼者】LINE、AWS、Kiro Web の準備（段階3と段階5の前に）
    - [x] 本番の LINE 公式アカウントのトークンを `/tanakaya/prod/line-channel-access-token`、依頼者のユーザー ID を `/tanakaya/prod/line-destination-user-id` に、どちらも SSM の SecureString で登録する。トークンはチャットに貼らない
    - [x] `aws sso login` で AWS の認証情報を用意する（プロファイル `mamelabo`）
    - [ ] Kiro Web のクラウド構成を設定し、ローカルの `.kiro` を同期する（依頼者が後で行う）
    - _要件：7.1、7.2。レッスン：6、ボーナス1_

- [x] 2. 段階2：営業日の判定とプロパティベーステスト（レッスン4。遅くとも 10/6 04:00）
  - [x] 2.1 日付の関数を作る（`src/calendar/date.ts`）
    - `WEEKDAYS`、`toJstDate`、`addDays`、`weekdayOf`、`isIsoDate`。実行環境のタイムゾーンを読む API は使わない
    - 単体テスト：UTC の 14:59 と 15:00、月末、年末、2月29日、存在しない日付
    - _要件：共通の制約、5.2_
  - [x] 2.2 判定機能を作る（`src/calendar/judge.ts`）
    - `judgeDay`、`toBusinessRules`
    - _要件：1.1〜1.5_
  - [x] 2.3 P1〜P4 のプロパティベーステストを書く（`src/calendar/judge.property.test.ts`）
    - 生成器（日付、営業曜日、有効な設定）は `src/testing/arbitraries.ts` にまとめ、後の段階でも使う
    - _要件：1.2〜1.5。性質：P1〜P4_
  - [x] 2.4 設定の検証を作る（`src/settings/validate.ts`）
    - 単体テスト：規則ごとの違反、違反をすべて返すこと、営業曜日が不正なときに例外の曜日の検証を飛ばすこと
    - _要件：2.1、2.3〜2.9_
  - [x] 2.5 P9 のプロパティベーステストを書く（`src/settings/validate.property.test.ts`）
    - _要件：2.3、2.5、2.6。性質：P9_
  - [x] 2.6 見本の設定 `data/settings.example.json` を作り、検証を通ることを単体テストで確かめる
    - _要件：2.10_

- [ ] 3. 段階3：MCP、カスタムエージェント、自作 Power（レッスン6、7、ボーナス2。遅くとも 10/6 07:30）
  - [x] 3.1 【承認】LINE Bot MCP Server の接続を設定する
    - Kiro の公式ドキュメントで、MCP サーバーを特定のエージェントだけに使わせる方法を確かめてから設定する
    - LINE Bot MCP Server は、起動時に SSM の2つのパラメータを読んで環境変数（`CHANNEL_ACCESS_TOKEN`、`DESTINATION_USER_ID`）で渡す。トークンをファイルに書かない
    - broadcast 系のツールを hook で止め、依頼者宛ての push（`userId` を指定しない）と通数の確認だけを通す
    - テンプレートの `github` と `fetch` の設定を見直す（自動承認を外すか、使わないなら消す）
    - 結果：接続は `.kiro/agents/line-tester.md` の `mcpServers` に置き、ワークスペースの `mcp.json` には置かない。hook は `harness-line-send.json`。`.kiro/settings/mcp.json` の見直しは、Kiro の権限設定でエージェントからは書けないため、依頼者が行う
    - _要件：7.1。レッスン：6_
  - [x] 3.2 【承認】カスタムエージェントを整える
    - `line-tester` を作る。LINE Bot MCP Server だけを使え、依頼者宛ての push と通数の確認だけを行う
    - `spec-checker`、`security-auditor`、`unit-tester` を本プロジェクト向けに直す。テンプレートに `.md` と `.json` の2形式があるので、IDE が読む形式を公式ドキュメントで確かめて1つにする
    - 計画にない `doc-updater` を消す
    - _レッスン：7_
  - [ ] 3.3 【承認】`line-tester` で依頼者宛てに push で試験送信する
    - 文面は design の通常営業の文面に「【試験送信】」を付けたもの。`userId` を指定せず、既定の宛先（依頼者）に送る
    - 2026-10-06 02:15 の実行では、サブエージェントの `line-tester` に LINE Bot MCP Server のツールが現れず、送っていない（ツールは4つで、MCP のツールがなかった）。MCP サーバー自体は手元で起動し、12個のツールを返すことを確かめた
    - 2026-10-06 17:30 と 2026-10-24 01:20 にも、サブエージェントとして呼んだときにツールが現れなかった。どちらの時刻も `~/.kiro/logs/*/mcp.log` に `line-bot` の起動の記録がない。サブエージェントとして呼ぶと、`line-tester` 自身の `mcpServers` が起動しないとみられる（公式ドキュメントには、サブエージェントの MCP は「メインと共有」とだけある）。10/6 13:42〜17:17 には `line-bot` が接続していたが、何から起動したかはログからは分からない
    - 次の切り分け：【依頼者】エージェントの切り替えで `line-tester` をメインにし、`get_message_quota` だけを呼ぶ
    - _要件：7.1。レッスン：6、7_
  - [x] 3.4 【承認】自作 Power `powers/line-announce/` を作る
    - Kiro の公式ドキュメントで Power のファイル構成を確かめてから作る
    - LINE Bot MCP Server の接続設定（トークンは環境変数）と、安全な配信手順の steering を入れる。手順には、依頼者宛ての push での確認、本番配信前の文面の確認、月200通の上限の確認を含める
    - _レッスン：ボーナス2_
  - [x]* 3.5 【承認】使わないテンプレートの skills を消す
    - `e2e-testing`、`guardrails-setup`、`prod-ops`、`project-init`、`update-docs`

- [x] 4. 段階4：公開用データと前日配信のロジック（レッスン4、ボーナス1。遅くとも 10/6 10:00）
  - [x] 4.1 公開用データを作る（`buildCalendarData`、`parseCalendarData`）と P7
    - _要件：3.1〜3.5。性質：P7_
  - [x] 4.2 「今日」と月の選択を作る（`selectToday`、`selectMonths`）と P8
    - _要件：4.2〜4.5。性質：P8_
  - [x] 4.3 配信の計画を作る（`planNotification`）と P6
    - _要件：5.2〜5.6。性質：P6_
  - [x] 4.4 【クラウドセッション】案内の文面を作る（`buildMessage`）と単体テスト
    - 4.1〜4.3 を push してから、Kiro Web のクラウドセッションで実装して PR にする。使えないときは手元で実装する
    - 現状：`src/notify/message.ts` に型（`MessageInput`）と関数の形だけがあり、`buildMessage` は呼ぶと `NotImplementedError` を投げる。配信処理はこの例外では配信記録を作らずに止まる。実装したら、`runNotify.test.ts` の「buildMessage is not implemented」のテストを消す
    - _要件：5.7。レッスン：ボーナス1_
  - [x] 4.5 配信処理の本体を作る（`runNotify`）と P5
    - 単体テスト：SSM の失敗、記録の重複、送信の失敗、`markSent` の失敗、対象日が公開用データにない場合
    - _要件：5.3〜5.6、5.8、6.1〜6.4。性質：P5_
  - [x] 4.6 LINE への送信を作る（`lineClient.ts`）
    - `fetch` を偽物にした単体テストで、2xx、429、500、10秒の打ち切りを確かめる。本物の LINE には送らない
    - _要件：5.9、6.4、7.1_
  - [x] 4.7 配信記録と Lambda の入口を作る（`deliveryStore.ts`、`handler.ts`）
    - 条件付き PutItem で `exists` を返すこと、ログにトークンを出さないことを確かめる
    - _要件：6.2、6.6、7.1、7.2_

- [ ] 5. 段階5：公開ページ、SAM、テスト用スタック（レッスン5。遅くとも 10/6 12:45）
  - テスト用スタックは配信を無効（`NotifyEnabled=false`）のままにする。配信を有効にした確認（旧 5.5）は行わない
  - [x] 5.1 公開ページとビルドを作る
    - `public/index.html`、`public/style.css`、`src/publish/page.ts`、`scripts/build-site.ts`
    - 単体テスト：見本の設定でビルドが通ること、壊れた設定で終了コード1になり成果物を書かないこと
    - _要件：2.2、2.9、3.1、3.2、4.1〜4.8_
  - [x] 5.2 `template.yaml` と `samconfig.toml`（`test` と `prod`）を、1.4 の Power を使って書く
    - `sam validate --lint` と Power の検証を通す
    - _要件：3.6、4.1、5.1、6.2、6.6、7.2〜7.4。レッスン：5_
  - [x] 5.3 手順書 `docs/runbooks/deploy.md` を書く
    - デプロイの流れ（1.4 の Power のツールを使う手順を含む）、承認の取り方、戻し方、凍結期間中に休業日を変える方法
  - [x] 5.4 【承認】1.4 の Power を使ってテスト用スタックにデプロイし、公開ページを確かめる（`NotifyEnabled=false`）
    - Power の MCP サーバーの `--allow-write` は、このデプロイの直前に有効にする。それまでは読み取り専用のまま使う
    - `--allow-write` を有効にした後も、デプロイ系のツールは hook（`power-change-check.sh`）の承認条件で止める
    - スマートフォンの幅で表示を確かめ、デモ動画用の URL を控える
    - _要件：3.6、4.1〜4.8。レッスン：5_

- [ ] 6. 段階6：README と提出前の確認（遅くとも 10/6 13:45）
  - [x] 6.1 README を書く
    - 概要、構成図、セットアップ、デプロイ、レッスンとボーナスごとの該当ファイルの対応表、Power の導入の手順
  - [ ]* 6.2 `spec-checker` と `security-auditor` を実行し、指摘を直す
    - _レッスン：7_
  - [ ] 6.3 【承認】残りの PR をマージし、計画8章の確認項目を確かめる
    - 秘密情報がリポジトリと履歴にないこと、最初のコミットの日時、`.kiro` が公開されていること

- [ ] 7. 段階7：【依頼者】提出（締切 10/6 15:59）
  - [ ] 7.1 デモ動画（30秒〜3分）を撮る
    - 映すもの：Spec、steering、hook の実行、プロパティベーステストの実行、Power、MCP での試験送信、カスタムエージェント、クラウドセッション、自作 Power、公開ページ、届いた LINE
  - [ ] 7.2 X か LinkedIn に、#KiroUniversity と規約で指定されたタグを付けて投稿する
  - [ ] 7.3 エントリーフォームを提出する（遅くとも 15:30。29分の予備を残す）
    - 提出後は commit、push、マージをしない

- [ ]* 8. 提出後に行ってよい作業（git を使わない）
  - 【承認】本番スタックにデプロイし、本番の LINE 公式アカウントで配信を有効にする（`NotifyEnabled=true`。友だち全員に届くため、依頼者の指示を受けてから）
  - 休業日の変更は `data/settings.json` を書き換えて、手順書のとおりデプロイする

- [ ] 9. 審査後の変更
  - [x] 9.1 【承認】案内の文面を、田中屋がふだんの告知で使う文面に変える
    - 依頼者が指定した3種類の文面にする（2026-10-06。本番の前日配信はこの文面で動いている）。末尾はホームページと Instagram で、臨時休業はホームページだけ。公開ページの URL は入れない
    - 要件 5.7（2026-10-23）と design の文面（2026-10-24）を合わせる
    - PR #10
    - _要件：5.7_
