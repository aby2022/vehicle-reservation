// 预览：解析腾讯文档车辆预约表（今日/区间），仅打印，不写数据
const { parseTdoc } = require('./tdoc-parse');

(async () => {
  const dateFrom = process.argv[2];
  const dateTo = process.argv[3];
  const { items, rosterSize, plateSet } = await parseTdoc(dateFrom, dateTo);
  console.log('人名库大小：', rosterSize);
  console.log('\n=== 解析结果（' + (dateFrom || '今天') + ' 起，共 ' + items.length + ' 条）===');
  const pad = (s, n) => { s = String(s == null ? '' : s); let w = 0; for (const c of s) w += c.charCodeAt(0) > 255 ? 2 : 1; return s + ' '.repeat(Math.max(0, n - w)); };
  console.log(pad('日期', 12) + pad('车牌', 11) + pad('使用人/预约人', 14) + pad('时间段', 14) + pad('地点', 16) + '事项');
  console.log('-'.repeat(96));
  for (const it of items) {
    const slot = it.startTime ? it.startTime + '-' + it.endTime : '（未标注）';
    console.log(pad(it.date, 12) + pad(it.plate, 11) + pad(it.person, 14) + pad(slot, 14) + pad(it.place || '—', 16) + (it.event || '—'));
  }
  const unkPlate = [...new Set(items.map(i => i.plate))].filter(p => !plateSet.has(p));
  console.log('\n系统中不存在的车牌（将跳过导入）：', unkPlate.length ? unkPlate.join(' / ') : '无');
  const noPlace = items.filter(i => !i.place);
  console.log('未拆出地点的去向（' + noPlace.length + ' 条，整体作为事项）：');
  [...new Set(noPlace.map(i => i.event))].forEach(e => console.log('   - ' + e));
})().catch(e => { console.error('失败：', e.message); process.exit(1); });
