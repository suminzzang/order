// 체험 모드: config.js 의 주소가 'mock' 일 때 앱스 스크립트 대신 브라우저 안에서 응답한다.
// 판사 코드 12345678 (홍길동), 87654321 (김판사). 주소에 ?mockItems=dropdown 을 붙이면 드롭다운 모드.
// 관리자 페이지(admin.html?s=demo) 관리자 코드 1234567890 (사장님).
(function () {
  var KEY = 'okc:mockdb';

  function load() {
    var db = null;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    return db || {
      sellers: [
        { id: 'S001', name: '홍길동', code: '12345678' },
        { id: 'S002', name: '김판사', code: '87654321' },
      ],
      orders: [],
    };
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* 저장 불가 시 무시 */ } }

  function pad(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }

  function config() {
    var dropdown = /mockItems=dropdown/.test(location.search);
    return {
      shopName: '○○농산 (체험)',
      notice: '마감 이후 주문은 다음 날 발송됩니다.',
      itemMode: dropdown ? 'dropdown' : 'text',
      items: dropdown ? ['사과 5kg', '사과 10kg', '배 7.5kg'] : [],
    };
  }


  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function md(day) { return day ? Number(day.slice(5, 7)) + '/' + Number(day.slice(8, 10)) : ''; }

  // 체험용 정산: 오늘 기준 지난 며칠치 (처음 한 번 만들어 저장)
  function ensureSettlements(db) {
    if (db.settlements) return;
    var back = function (n) { var d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
    var mk = function (sellerId, name, n, count, amount, paid) {
      var day = back(n);
      return { sellerId: sellerId, day: day, count: count, amount: amount, paid: paid, paidDay: paid ? back(n - 1) : '', by: paid ? '사장님' : '',
        text: ['[' + md(day) + ' 정산] ' + name + '님', '',
          '1. 김영희 / 장경례 긴특 호박고구마 5kg × ' + count + ' / ' + amount.toLocaleString() + '원',
          '──────────', '발송 ' + count + '건 / 합계 ' + amount.toLocaleString() + '원'].join('\n') };
    };
    db.settlements = [
      mk('S001', '홍길동', 4, 4, 120000, true), mk('S001', '홍길동', 3, 3, 80000, false),
      mk('S001', '홍길동', 2, 3, 95000, false), mk('S001', '홍길동', 1, 2, 64000, false),
      mk('S002', '김판사', 2, 1, 32000, true), mk('S002', '김판사', 1, 2, 60000, false),
    ];
  }

  function adminDetail(db, sellerId) {
    var seller = db.sellers.filter(function (s) { return s.id === sellerId; })[0];
    if (!seller) return { ok: false, error: '판사를 찾지 못했습니다.' };
    var cum = 0, unpaid = 0, days = 0, last = '';
    var rows = db.settlements.filter(function (x) { return x.sellerId === sellerId; })
      .sort(function (a, b) { return a.day < b.day ? -1 : 1; })
      .map(function (x) {
        if (!x.paid) { cum += x.amount; unpaid += x.amount; days++; } else if (x.paidDay > last) last = x.paidDay;
        return { day: x.day, label: md(x.day), count: x.count, amount: x.amount, noPrice: 0, carried: 0, paid: x.paid, paidDay: md(x.paidDay), by: x.by, cum: cum, text: x.text };
      });
    return { ok: true, detail: { id: seller.id, name: seller.name, payer: seller.payer || '', unpaid: unpaid, unpaidDays: days, lastPaid: md(last), rows: rows } };
  }

  function adminSummary(db) {
    var total = 0;
    var sellers = db.sellers.map(function (s) {
      var d = adminDetail(db, s.id).detail;
      total += d.unpaid;
      return { id: s.id, name: s.name, payer: s.payer || '', active: true, unpaid: d.unpaid, unpaidDays: d.unpaidDays, lastPaid: d.lastPaid };
    }).sort(function (a, b) { return b.unpaid - a.unpaid; });
    return { total: total, sellers: sellers, unsettledDays: [],
      activeSellers: db.sellers.map(function (s) { return { id: s.id, name: s.name }; }) };
  }

  function handleAdmin(req, db) {
    var admin = (db.admins || [{ id: 'A01', name: '사장님', code: '1234567890' }]).filter(function (a) { return a.code === String(req.code || ''); })[0];
    if (!admin) return { ok: false, auth: false, error: '관리자 코드가 맞지 않습니다. 코드를 다시 확인해 주세요.' };
    ensureSettlements(db);
    var mark = function (match, paid) {
      var today = ymd(new Date());
      var n = 0;
      db.settlements.forEach(function (x) {
        if (x.sellerId !== req.sellerId || !match(x.day) || x.paid === paid) return;
        x.paid = paid; x.paidDay = paid ? today : ''; x.by = paid ? admin.name : ''; n++;
      });
      if (!n) return { ok: false, error: '바꿀 정산이 없습니다. 화면을 새로고침해 주세요.' };
      save(db);
      return adminDetail(db, req.sellerId);
    };
    switch (req.action) {
      case 'adminLogin': save(db); return { ok: true, admin: { id: admin.id, name: admin.name }, shopName: config().shopName, summary: adminSummary(db) };
      case 'adminSummary': return { ok: true, summary: adminSummary(db) };
      case 'adminSeller': return adminDetail(db, req.sellerId);
      case 'adminSetPaid': return mark(function (d) { return d === req.day; }, !!req.paid);
      case 'adminPayThrough': return mark(function (d) { return d <= req.day; }, true);
      case 'adminOrder': {
        var seller = db.sellers.filter(function (s) { return s.id === req.sellerId; })[0];
        if (!seller) return { ok: false, error: '판사를 다시 골라 주세요.' };
        return handle({ action: 'order', code: seller.code, order: req.order, force: req.force, requestId: req.requestId });
      }
    }
    return { ok: false, error: '알 수 없는 요청입니다.' };
  }

  function handle(req) {
    var db = load();
    if (String(req.action || '').indexOf('admin') === 0) return handleAdmin(req, db);
    var seller = db.sellers.filter(function (s) { return s.code === String(req.code || ''); })[0];
    if (!seller) return { ok: false, auth: false, error: '판사 코드가 맞지 않습니다. 코드를 다시 확인해 주세요.' };
    var now = new Date();

    switch (req.action) {
      case 'login': {
        // 실제 서버처럼 내 주문·내 정산을 같이 보낸다
        var out = { ok: true, seller: { id: seller.id, name: seller.name }, config: config() };
        var include = req.include || [];
        if (include.indexOf('orders') !== -1) out.orders = handle({ action: 'myOrders', code: req.code }).orders;
        if (include.indexOf('settlements') !== -1) out.settlements = handle({ action: 'mySettlements', code: req.code }).settlements;
        return out;
      }

      case 'order': {
        var o = req.order || {};
        var existing = db.orders.filter(function (x) { return x.requestId && x.requestId === req.requestId; })[0];
        if (existing) return { ok: true, orderNo: existing.orderNo };
        if (!req.force) {
          var since = now.getTime() - 10 * 60 * 1000;
          var dup = db.orders.filter(function (x) {
            return x.sellerId === seller.id && x.status !== '취소' && x.at >= since &&
              x.name === o.name && x.phone.replace(/\D/g, '') === String(o.phone).replace(/\D/g, '') && x.item === o.item;
          })[0];
          if (dup) return { ok: false, dup: true, error: '10분 안에 같은 받는 분·품목 주문이 이미 있습니다 (주문번호 ' + dup.orderNo + '). 그래도 넣을까요?' };
        }
        var prefix = String(now.getFullYear()).slice(2) + pad(now.getMonth() + 1, 2) + pad(now.getDate(), 2) + '-';
        var seq = db.orders.filter(function (x) { return x.orderNo.indexOf(prefix) === 0; }).length + 1;
        var rec = {
          orderNo: prefix + pad(seq, 3), at: now.getTime(), sellerId: seller.id,
          item: o.item, qty: o.qty, name: o.name, phone: o.phone, address: o.address, memo: o.memo, etc: o.etc || '',
          status: '접수', tracking: '', requestId: req.requestId || '',
          // 체험 모드: '고구마'가 들어간 주문은 운영자가 정식 품목으로 확정한 것처럼 보여준다
          confirmed: /고구마/.test(o.item) ? '장경례 긴특 호박고구마 5kg' : '',
        };
        db.orders.push(rec);
        save(db);
        return { ok: true, orderNo: rec.orderNo };
      }

      case 'myOrders': {
        var list = db.orders.filter(function (x) { return x.sellerId === seller.id; }).slice().reverse().map(function (x) {
          var at = new Date(x.at);
          return {
            orderNo: x.orderNo, at: (at.getMonth() + 1) + '/' + at.getDate() + ' ' + pad(at.getHours(), 2) + ':' + pad(at.getMinutes(), 2),
            day: (at.getMonth() + 1) + '/' + at.getDate(),
            item: x.confirmed || x.item, requested: x.confirmed && x.confirmed !== x.item ? x.item : '', qty: x.qty, name: x.name, status: x.status, tracking: x.tracking,
          };
        });
        return { ok: true, orders: list };
      }

      case 'mySettlements': {
        // 체험 모드: 예시 정산 2건
        var t = new Date(); var y = new Date(t); y.setDate(t.getDate() - 1);
        var lab = function (d) { return (d.getMonth() + 1) + '/' + d.getDate(); };
        return { ok: true, settlements: [
          { label: lab(t), count: 2, amount: 92000, paid: false, paidDay: '',
            text: ['[' + lab(t) + ' 정산] ' + seller.name + '님', '',
              '1. 김영희 / 장경례 긴특 호박고구마 5kg × 2 / 64,000원 / 송장 6012345678901',
              '2. 이철수 / 사과 5kg × 1 / 28,000원 / 송장 6012345678902',
              '──────────', '발송 2건 / 합계 92,000원', '이월 1건 (다음 정산에 포함)'].join('\n') },
          { label: lab(y), count: 1, amount: 32000, paid: true, paidDay: '',
            text: ['[' + lab(y) + ' 정산] ' + seller.name + '님', '',
              '1. 박민수 / 장경례 긴특 호박고구마 5kg × 1 / 32,000원 / 송장 6012345678900',
              '──────────', '발송 1건 / 합계 32,000원'].join('\n') },
        ] };
      }

      case 'rename': {
        var name = String(req.name || '').replace(/\s+/g, ' ').trim().slice(0, 20);
        if (!name) return { ok: false, error: '이름을 입력해 주세요.' };
        seller.name = name;
        save(db);
        return { ok: true, seller: { id: seller.id, name: name } };
      }
    }
    return { ok: false, error: '알 수 없는 요청입니다.' };
  }

  window.MockApi = {
    call: function (req) {
      return new Promise(function (resolve) {
        // 실제 서버처럼 느리게 하려면 주소에 ?mockDelay=2000 (밀리초)
        var delay = Number((/mockDelay=(\d+)/.exec(location.search) || [])[1]) || 350;
        setTimeout(function () { resolve(handle(JSON.parse(JSON.stringify(req)))); }, delay);
      });
    },
  };
})();
