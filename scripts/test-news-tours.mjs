#!/usr/bin/env node
// ============================================
// scripts/lib/news-tours.mjs の単体テスト
// ============================================
// 公式サイトへ接続できない環境でもパース処理を検証できるようにするためのもの。
//   node scripts/test-news-tours.mjs
// 失敗時は exit code 1。

import {
  htmlToText,
  looksLikeTourAnnouncement,
  extractDatesFromLine,
  extractPerformances,
  extractLiveName,
  buildProvisionalLive,
  dropSupersededProvisionals,
  inferPrefecture,
  looksLikeVenue,
  parseNewsList,
} from './lib/news-tours.mjs';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.error(`  FAIL ${label}\n       expected: ${e}\n       actual:   ${a}`); }
}

function truthy(label, actual) {
  if (actual) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.error(`  FAIL ${label} — expected truthy, got ${JSON.stringify(actual)}`); }
}

function falsy(label, actual) {
  if (!actual) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.error(`  FAIL ${label} — expected falsy, got ${JSON.stringify(actual)}`); }
}

// ---------- fixture: 6期生全国ツアー2026 の告知を模した HTML ----------
// 康熙部首（⽊ / ⽣）や全角数字が混ざるケースも含めている。
const NEWS_HTML = `
<div class="news-detail">
  <h1>「乃⽊坂46 6期⽣全国ツアー2026」開催決定！</h1>
  <p>この度、乃木坂46 6期生による全国ツアーの開催が決定いたしました。</p>
  <p>【神奈川公演】<br>
  2026年10月26日(月)・27日(火)<br>
  KT Zepp Yokohama</p>
  <p>【北海道公演】<br>
  2026年11月10日(火)・11日(水)<br>
  Zepp Sapporo</p>
  <p>【大阪公演】<br>
  2026年11月17日(火)・18日(水)<br>
  Zepp Osaka Bayside</p>
  <p>【愛知公演】<br>
  2026年11月24日(火)・25日(水)<br>
  Zepp Nagoya</p>
  <p>【福岡公演】<br>
  2026年12月1日(火)・2日(水)<br>
  Zepp Fukuoka</p>
  <p>チケット先行受付は2026年8月30日(日)より開始予定です。</p>
</div>
`;

console.log('htmlToText / 正規化');
{
  const text = htmlToText(NEWS_HTML);
  truthy('康熙部首が正規化される (⽊ → 木)', text.includes('乃木坂46 6期生全国ツアー2026'));
  truthy('<br> が改行になり、ラベル→日付→会場が別行になる',
    /【神奈川公演】\n+2026年10月26日[^\n]*\n+KT Zepp Yokohama/.test(text));
}

console.log('looksLikeTourAnnouncement');
{
  truthy('ツアー開催決定', looksLikeTourAnnouncement('「乃木坂46 6期生全国ツアー2026」開催決定！'));
  truthy('単独ライブ開催決定', looksLikeTourAnnouncement('42ndSGアンダーライブ開催決定'));
  falsy('グッズ情報は除外', looksLikeTourAnnouncement('全国ツアーグッズ販売のお知らせ'));
  falsy('中止告知は除外', looksLikeTourAnnouncement('全国ツアー公演中止のお知らせ'));
  falsy('無関係なニュース', looksLikeTourAnnouncement('新シングル発売決定'));
}

console.log('extractDatesFromLine');
{
  check('年月日 + 日 の continuation',
    extractDatesFromLine('2026年10月26日(月)・27日(火)').dates,
    ['2026-10-26', '2026-10-27']);
  check('全角数字',
    extractDatesFromLine('２０２６年１２月１日').dates,
    ['2026-12-01']);
  check('「3日間」は公演日として拾わない',
    extractDatesFromLine('全国3日間で開催').dates,
    []);
  check('年月が未確定の断片は捨てる',
    extractDatesFromLine('26日・27日').dates,
    []);
  check('carry で年月を引き継ぐ',
    extractDatesFromLine('26日・27日', { year: 2026, month: 10 }).dates,
    ['2026-10-26', '2026-10-27']);
}

console.log('inferPrefecture / looksLikeVenue');
{
  check('【神奈川公演】', inferPrefecture('【神奈川公演】'), '神奈川県');
  check('【大阪公演】は府', inferPrefecture('【大阪公演】'), '大阪府');
  check('【東京公演】は都', inferPrefecture('【東京公演】'), '東京都');
  check('【北海道公演】', inferPrefecture('【北海道公演】'), '北海道');
  check('公演ラベルでなければ拾わない', inferPrefecture('大阪のスタッフより'), null);
  truthy('Zepp を会場と判定', looksLikeVenue('KT Zepp Yokohama'));
  truthy('アリーナを会場と判定', looksLikeVenue('有明アリーナ'));
  falsy('開場時刻の行は会場ではない', looksLikeVenue('開場 17:00 / 開演 18:30'));
}

console.log('extractPerformances (6期生ツアー fixture)');
{
  const perfs = extractPerformances(htmlToText(NEWS_HTML));
  // 先行受付日 (8/30) は会場が無いので公演としては拾われるが venue=null になる。
  const withVenue = perfs.filter(p => p.venue);
  check('会場付きの公演が5件', withVenue.length, 5);
  check('神奈川公演の日程', withVenue[0].dates, ['2026-10-26', '2026-10-27']);
  check('神奈川公演の会場', withVenue[0].venue, 'KT Zepp Yokohama');
  check('神奈川公演の都道府県', withVenue[0].prefecture, '神奈川県');
  check('福岡公演の日程', withVenue[4].dates, ['2026-12-01', '2026-12-02']);
  check('福岡公演の会場', withVenue[4].venue, 'Zepp Fukuoka');
}

console.log('extractLiveName');
{
  check('「」内を取り出し告知語尾を除去',
    extractLiveName('「乃木坂46 6期生全国ツアー2026」開催決定！'),
    '乃木坂46 6期生全国ツアー2026');
  check('括弧が無い場合',
    extractLiveName('42ndSGアンダーライブ開催決定'),
    '42ndSGアンダーライブ');
}

console.log('buildProvisionalLive');
{
  const perfs = extractPerformances(htmlToText(NEWS_HTML)).filter(p => p.venue);
  const live = buildProvisionalLive({
    artist: '乃木坂46',
    idPrefix: 'nogi',
    newsId: '102198',
    title: '「乃⽊坂46 6期⽣全国ツアー2026」開催決定！',
    url: 'https://www.nogizaka46.com/s/n46/news/detail/102198',
    performances: perfs,
    scrapedAt: '2026-08-26T00:00:00.000Z',
  });
  truthy('エントリが生成される', live);
  check('provisional フラグ', live.provisional, true);
  check('sourceType', live.sourceType, 'news');
  check('eventType は tour', live.eventType, 'tour');
  check('名前', live.name, '乃木坂46 6期生全国ツアー2026');
  check('dateStart', live.dateStart, '2026-10-26');
  check('dateEnd', live.dateEnd, '2026-12-02');
  check('children 5件', live.children.length, 5);
  check('children[2] 大阪', live.children[2].venue, 'Zepp Osaka Bayside');
  truthy('officialId に news が入る', live.officialId.includes('news102198'));
}

console.log('dropSupersededProvisionals');
{
  const prov = [{ artist: '乃木坂46', name: '乃木坂46 6期生全国ツアー2026' }];
  check('正式データが無ければ残る',
    dropSupersededProvisionals([], prov).length, 1);
  check('同名の正式データがあれば捨てる',
    dropSupersededProvisionals(
      [{ artist: '乃木坂46', name: '乃木坂46 6期生全国ツアー2026' }], prov).length, 0);
  check('表記ゆれ（空白・記号）も同一視',
    dropSupersededProvisionals(
      [{ artist: '乃木坂46', name: '乃木坂46　6期生 全国ツアー 2026' }], prov).length, 0);
  check('別アーティストなら残る',
    dropSupersededProvisionals(
      [{ artist: '櫻坂46', name: '乃木坂46 6期生全国ツアー2026' }], prov).length, 1);
  check('無関係な正式データなら残る',
    dropSupersededProvisionals(
      [{ artist: '乃木坂46', name: '乃木坂46 真夏の全国ツアー2026' }], prov).length, 1);
}

console.log('parseNewsList');
{
  const RE = /\/s\/n46\/news\/detail\/(\d+)/g;

  check('素の JSON 配列',
    parseNewsList('[{"code":"102198","title":"ツアー開催決定"}]', 'application/json', RE),
    [{ id: '102198', title: 'ツアー開催決定' }]);

  check('list キー配下',
    parseNewsList('{"list":[{"id":"999","title":"お知らせ"}]}', 'application/json', RE),
    [{ id: '999', title: 'お知らせ' }]);

  check('JSONP ラッパーを剥がす',
    parseNewsList('res({"list":[{"code":"555","subject":"ライブ開催決定"}]});', 'text/javascript', RE),
    [{ id: '555', title: 'ライブ開催決定' }]);

  check('id/title が欠けた要素は捨てる',
    parseNewsList('{"list":[{"code":"1"},{"code":"2","title":"あり"}]}', 'application/json', RE),
    [{ id: '2', title: 'あり' }]);

  {
    const html = '<a href="/s/n46/news/detail/102198?ima=0000">' +
                 '<p class="t">「6期生全国ツアー2026」開催決定！</p></a>';
    const got = parseNewsList(html, 'text/html', RE);
    check('HTML フォールバックで id を拾う', got.length, 1);
    check('HTML フォールバックの id', got[0].id, '102198');
    truthy('HTML フォールバックでタイトルらしき文字列が取れる',
      got[0].title.includes('6期生全国ツアー2026'));
  }

  check('detailPathRe 無し・JSON でもない場合は空',
    parseNewsList('<html>no links</html>', 'text/html', null), []);
}

console.log();
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
