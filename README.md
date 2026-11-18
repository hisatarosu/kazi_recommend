# kazi_recommend

家事をLINEでレコメンドするbotです。Cloudflare Workers で動きます。

- **毎朝7:00**:今日のゴミの日と、やり時の家事(最大3件)を「やった / 今日はパス」ボタン付きで通知
- **前日19:00**:不燃ごみなど `remindNightBefore: true` を付けたゴミの前日だけリマインド
- **トークで「今日」「一覧」「ヘルプ」**:その場で返信(返信は無料枠の通数にカウントされない)

## しくみ

`前回からの経過日数 ÷ この家での間隔` が 1 以上の家事を、遅れている順に提案します。

**使うほど家のペースに合っていきます**(`src/learn.ts`)

- **間隔の学習**:最初は `config.ts` の目安日数から始めます。「やった」を押すたびに実際の間隔の3割を反映し、5回ほどで家のペースにほぼ合います。
  例:目安7日のトイレ掃除を実際は10日おきにしていると、7.9 → 8.5 → 9.0 → 9.3 → 9.5日と寄っていきます。
- **外れ値に強い**:久しぶりにやった1回は、推定値の2倍までに抑えて反映します。
- **パスの学習**:続けてパスすると、次に提案するまでの日数が 1 → 2 → 4 → 7日と延びます。「やった」でリセットされます。
- 学習した値は通知に「いつも約9日おき・記録4回」と表示されます。

提案されていない家事も、「一覧」のボタンからいつでも記録できます。記録が多いほど推定は正確になります。

設定は `src/config.ts` を編集します(ゴミの曜日・第n週、収集の休み、家事と目安日数、1日の提案数)。

収集の休みは `GARBAGE_HOLIDAYS` に書きます。毎年なら `{ from: "12-31", to: "01-03" }`、その年だけなら `{ from: "2029-01-15" }` の形式です。
`npm run deploy` はテストが通ったときだけデプロイします。設定の書き間違いもテストで見つかります。

## セットアップ

### 1. LINE 側

1. [LINE Official Account Manager](https://manager.line.biz/) で公式アカウントを作り、設定 → Messaging API を有効化する
2. [LINE Developers](https://developers.line.biz/console/) でそのチャネルを開き、次の2つを控える
   - チャネル基本設定 → **チャネルシークレット**
   - Messaging API設定 → **チャネルアクセストークン(長期)** を発行
3. Official Account Manager の設定で以下を変える
   - 応答設定:**Webhook をオン**、**応答メッセージをオフ**
   - アカウント設定:**グループ・複数人トークへの参加を許可する**

### 2. Cloudflare 側

```sh
npm install
npx wrangler login
npx wrangler d1 create kazi-recommend      # 表示された database_id を wrangler.toml に貼る
npm run db:migrate
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put LINE_CHANNEL_SECRET
npm run deploy                             # https://kazi-recommend.<あなた>.workers.dev が表示される
```

### 3. つなぐ

1. LINE Developers の Messaging API設定 → Webhook URL に `https://kazi-recommend.<あなた>.workers.dev/webhook` を入れて「検証」→「Webhookの利用」をオン
2. QRコードからbotを友だち追加し、家族のLINEグループに招待する

グループが1つでもあればグループにだけ通知します(友だち追加した人に二重に届かないように)。

## 通数の目安

無料プランは月200通です。グループへのプッシュは **メンバー数ぶん** 数えられます。
3人のグループなら、朝 30日 × 3人 = 90通、前日19時(びん缶 月2回 + 不燃ごみ 月1回)3 × 3人 = 9通で、合計約99通です。
前日通知を付けるゴミを増やすと、そのぶん増えます。

## 開発

```sh
npm test               # ロジックのテスト
npm run typecheck
cp .dev.vars.example .dev.vars   # 値を入れる
npm run db:migrate:local
npx wrangler dev --test-scheduled
curl "localhost:8787/__scheduled?cron=0+22+*+*+*"   # 定時実行を手動で起こす
```
