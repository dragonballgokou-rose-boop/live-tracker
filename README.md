# live-tracker

🎸 ライブ参戦集計表 - チームでライブの参戦状況を管理・集計するWebアプリ

## 機能
- ライブイベント管理（複数日対応）
- メンバー管理
- 参戦集計表（マトリクス形式）
- エクスポート/インポート
- PWA対応（スマホアプリ風に使用可能）

## 開発
```bash
npm install
npm run dev
```

## デプロイ
GitHub Pagesで自動デプロイ（pushで自動更新）

## 公式ライブ情報の自動更新（乃木坂46 / 櫻坂46）
- `scripts/scrape-official.mjs` が両公式サイトの schedule ページをパースし `public/official-lives.json` を生成
- `.github/workflows/update-official-lives.yml` が毎日 06:00 JST に自動実行し差分があればコミット
- アプリ側ではヘッダーの同期ボタンから「公式ライブ情報の同期」モーダルを開き、新規/差分/一致の3タブで確認
- ローカルのライブは自動削除・自動上書きされず、ユーザーがチェックした項目のみ反映される
- 更新時は `memo` 欄に根拠URLと取得日が追記される

### ニュース欄からの「暫定」ツアー取り込み
公式のライブ一覧 API は個別ライブページが作られるまで公演を返さないため、
発表済みでも数日〜数週間ヒットしないことがある（例: 6期生全国ツアー2026）。
そこで `scripts/lib/news-tours.mjs` がニュース欄の告知本文から日程・会場を推定する。

- 抽出したものは `provisional: true` / `sourceType: 'news'` を付けた**暫定エントリ**
- 同期モーダルでは琥珀色の「暫定」タグと注意書きを表示する
- 正式にライブ API へ載ると `dropSupersededProvisionals` が暫定側を落とすので重複しない
- 正式データが 1 件も取れなかった実行では暫定データだけで JSON を上書きしない
- パース処理は純粋関数なのでネットワーク無しで検証できる: `npm run test:news`
- ニュース走査の結果は `official-lives.json` の `newsScan` に診断として残る
