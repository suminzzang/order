(function () {
  'use strict';

  // ───────── 설정 · 저장소 ─────────
  // 주문서(app.js)와 같은 config.js 를 쓴다. 사업장은 링크의 ?s= 로만 고른다
  var CFG = window.ORDER_CONFIG || { shops: {} };
  var params = new URLSearchParams(location.search);
  var shopKey = params.get('s') || '';
  var badLink = !Object.prototype.hasOwnProperty.call(CFG.shops, shopKey) || !CFG.shops[shopKey];
  var apiUrl = badLink ? '' : CFG.shops[shopKey];
  var isMock = apiUrl === 'mock';
  var CODE_KEY = 'okc:' + shopKey + ':admin';
  // 첫 화면 요약(판사별 미입금 합계)만 기기에 기억한다. 정산 문구(받는 분 이름 포함)는 남기지 않는다
  var SUMMARY_KEY = 'okc:' + shopKey + ':adminSummary';
  // 이 시간(밀리초) 안에 받은 요약은 다시 받지 않는다
  var FRESH_MS = 30000;
  var memoryStore = {};

  function storeGet(k) {
    try { var v = localStorage.getItem(k); return v === null ? memoryStore[k] || '' : v; } catch (e) { return memoryStore[k] || ''; }
  }
  function storeSet(k, v) {
    memoryStore[k] = v;
    try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* 사생활 보호 모드 등 */ }
  }

  // ───────── 상태 ─────────
  var state = {
    code: storeGet(CODE_KEY),
    admin: null,
    shopName: '',
    summary: null,
    summaryAt: 0,
    details: {}, // 판사ID → 상세 (메모리에만)
    loginError: '',
    sellerId: '',
    draft: emptyDraft(),
    requestId: '',
    orderView: 'form', // form | confirm | done
    lastResult: null,
  };

  function emptyDraft() {
    return { item: '', qty: 1, name: '', phone: '', address: '', memo: '', etc: '' };
  }

  var app = document.getElementById('app');

  function loadSummary() {
    try {
      var c = JSON.parse(storeGet(SUMMARY_KEY) || 'null');
      return c && state.code && c.code === state.code ? c : null;
    } catch (e) { return null; }
  }
  function saveSummary() {
    storeSet(SUMMARY_KEY, JSON.stringify({ code: state.code, admin: state.admin, shopName: state.shopName, summary: state.summary, at: state.summaryAt }));
  }

  function logout(message) {
    storeSet(CODE_KEY, '');
    storeSet(SUMMARY_KEY, '');
    state.code = '';
    state.admin = null;
    state.summary = null;
    state.details = {};
    state.loginError = message || '';
    route();
  }

  // ───────── API ─────────
  function api(action, extra) {
    var body = Object.assign({ action: action, code: state.code }, extra || {});
    var timer = null;
    var started = Date.now();
    var request;
    if (isMock) {
      request = window.MockApi.call(body);
    } else {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 45000) : null;
      // text/plain 으로 보내야 앱스 스크립트가 CORS 사전 요청 없이 받는다
      request = fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    return request.catch(function () {
      return { ok: false, network: true, error: '연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.' };
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      if (window.console && console.info) console.info('[api] ' + action + ' ' + (Date.now() - started) + 'ms' + (res && res.ms != null ? ' (서버 ' + res.ms + 'ms)' : ''));
      if (res && res.auth === false) logout(res.error);
      return res;
    });
  }

  // ───────── 도우미 ─────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function digits(v) { return String(v || '').replace(/\D/g, ''); }

  function won(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원'; }

  function formatPhoneLive(v) {
    var d = digits(v).slice(0, 12);
    if (/^02/.test(d)) {
      if (d.length <= 2) return d;
      if (d.length <= 5) return d.slice(0, 2) + '-' + d.slice(2);
      if (d.length <= 9) return d.slice(0, 2) + '-' + d.slice(2, 5) + '-' + d.slice(5);
      return d.slice(0, 2) + '-' + d.slice(2, 6) + '-' + d.slice(6, 10);
    }
    if (d.length === 12) return d.slice(0, 4) + '-' + d.slice(4, 8) + '-' + d.slice(8);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + '-' + d.slice(3);
    if (d.length <= 10) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
    return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7, 11);
  }

  function validPhone(v) {
    var d = digits(v);
    if (/^02/.test(d)) return d.length === 9 || d.length === 10;
    return /^0\d{9,11}$/.test(d);
  }

  function newRequestId() {
    if (window.crypto && crypto.getRandomValues) {
      var a = new Uint32Array(4);
      crypto.getRandomValues(a);
      return Array.prototype.map.call(a, function (n) { return n.toString(16); }).join('');
    }
    return String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.dataset.label = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>' + esc(label || '처리 중');
    } else {
      btn.disabled = false;
      if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
    }
  }

  function hhmm(ms) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return Promise.resolve(ok);
  }

  // ───────── 머리 · 라우팅 ─────────
  function currentTab() {
    var h = location.hash.replace('#', '');
    if (h === 'order') return 'order';
    if (h.indexOf('s/') === 0) return 'seller';
    return 'home';
  }

  function renderHeader() {
    var title = state.shopName ? state.shopName + ' 관리자' : '관리자';
    document.getElementById('shopName').textContent = title;
    document.title = title;
    document.getElementById('whoName').textContent = state.admin ? state.admin.name + '님' : '';
    document.getElementById('tabs').hidden = !state.admin;
    document.getElementById('mockBadge').hidden = !isMock;
    var tab = currentTab() === 'seller' ? 'home' : currentTab();
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (a) {
      a.classList.toggle('on', a.dataset.tab === tab);
    });
  }

  function route(navigated) {
    renderHeader();
    if (badLink) return renderBadLink();
    if (!state.code) return renderLogin();
    if (!state.admin) return boot();
    var tab = currentTab();
    if (tab === 'order') return renderOrder();
    if (tab === 'seller') return renderSeller(decodeURIComponent(location.hash.slice(3)), navigated);
    return renderHome();
  }

  window.addEventListener('hashchange', function () {
    if (currentTab() === 'order' && state.orderView === 'done') state.orderView = 'form';
    route(true);
    window.scrollTo(0, 0);
  });

  function renderBadLink() {
    app.innerHTML = '<div class="card"><h1>링크가 올바르지 않습니다</h1>' +
      '<p class="sub">관리자 페이지 주소 끝에 사업장(?s=…)이 빠졌습니다. 받은 주소를 그대로 열어 주세요.</p></div>';
  }

  // 기억해 둔 요약이 있으면 바로 보여주고, 코드 확인과 새 요약은 뒤에서 받는다
  function boot() {
    var c = loadSummary();
    if (c && c.admin && c.summary) {
      state.admin = c.admin;
      state.shopName = c.shopName || '';
      state.summary = c.summary;
      state.summaryAt = c.at || 0;
      route();
      login();
      return;
    }
    app.innerHTML = '<div class="loading">불러오는 중…</div>';
    login().then(function (res) {
      if (!res.ok && res.auth !== false) {
        app.innerHTML = '<div class="card"><div class="alert alert-error">' + esc(res.error) + '</div>' +
          '<button class="btn btn-primary btn-block" id="retry">다시 시도</button></div>';
        document.getElementById('retry').onclick = boot;
      }
    });
  }

  function login() {
    var hadAdmin = !!state.admin;
    return api('adminLogin').then(function (res) {
      if (!res.ok) return res;
      state.admin = res.admin;
      state.shopName = res.shopName || '';
      state.summary = res.summary;
      state.summaryAt = Date.now();
      saveSummary();
      if (!hadAdmin || currentTab() === 'home') route();
      else renderHeader();
      return res;
    });
  }

  // ───────── 관리자 코드 입력 ─────────
  function renderLogin() {
    app.innerHTML =
      '<div class="card">' +
      '<h1>관리자 코드 입력</h1>' +
      '<p class="sub">시트 메뉴 [관리자 추가]로 받은 10자리 관리자 코드를 입력해 주세요. 이 기기에서 한 번만 입력하면 됩니다.</p>' +
      (state.loginError ? '<div class="alert alert-error">' + esc(state.loginError) + '</div>' : '') +
      '<form id="loginForm" novalidate>' +
      '<input id="code" class="code-input" inputmode="numeric" autocomplete="off" maxlength="10" placeholder="0000000000" aria-label="관리자 코드">' +
      '<button class="btn btn-primary btn-block" id="loginBtn" type="submit">확인</button>' +
      '</form>' +
      (isMock ? '<p class="sub center" style="margin-top:14px">체험용 코드: 1234567890</p>' : '') +
      '</div>';
    var input = document.getElementById('code');
    input.addEventListener('input', function () { input.value = digits(input.value).slice(0, 10); });
    document.getElementById('loginForm').onsubmit = function (e) {
      e.preventDefault();
      var code = digits(input.value);
      if (code.length !== 10) {
        state.loginError = '관리자 코드는 숫자 10자리입니다.';
        return renderLogin();
      }
      setBusy(document.getElementById('loginBtn'), true, '확인 중');
      state.code = code;
      login().then(function (res) {
        if (res.ok) {
          storeSet(CODE_KEY, code);
          state.loginError = '';
        } else if (res.auth !== false) {
          state.code = '';
          state.loginError = res.error;
          renderLogin();
        }
      });
    };
    setTimeout(function () { input.focus(); }, 50);
  }

  // ───────── 첫 화면: 판사별 미입금 ─────────
  var summaryInflight = null;

  function refreshSummary() {
    if (!summaryInflight) {
      summaryInflight = api('adminSummary').then(function (res) {
        summaryInflight = null;
        if (res.ok) {
          state.summary = res.summary;
          state.summaryAt = Date.now();
          saveSummary();
        }
        return res;
      });
    }
    return summaryInflight;
  }

  function renderHome() {
    var fresh = state.summary && Date.now() - state.summaryAt < FRESH_MS;
    if (state.summary) drawHome(fresh ? '' : '<div class="stale"><span class="spinner"></span>' + (state.summaryAt ? hhmm(state.summaryAt) + ' 기준 · ' : '') + '새로고침 중</div>');
    else app.innerHTML = '<div class="loading">불러오는 중…</div>';
    if (fresh) return;
    refreshSummary().then(function (res) {
      if (currentTab() !== 'home' || !state.admin) return;
      if (res.ok) return drawHome('');
      if (res.auth === false) return;
      if (state.summary) {
        drawHome('<div class="stale">새로고침하지 못했습니다 <button class="link-btn" id="reloadHome">다시 시도</button></div>');
        document.getElementById('reloadHome').onclick = function () { state.summaryAt = 0; renderHome(); };
      } else {
        app.innerHTML = '<div class="card"><div class="alert alert-error">' + esc(res.error) + '</div>' +
          '<button class="btn btn-block" id="reloadHome">다시 시도</button></div>';
        document.getElementById('reloadHome').onclick = renderHome;
      }
    });
  }

  function drawHome(statusHtml) {
    var s = state.summary;
    var owing = s.sellers.filter(function (x) { return x.unpaid > 0; }).length;
    var html = statusHtml +
      '<div class="card"><div class="sub">전체 미입금</div>' +
      '<div class="settle-amount' + (s.total > 0 ? ' due' : '') + '">' + esc(won(s.total)) + '</div>' +
      '<div class="order-meta">미입금 판사 ' + owing + '명 / 전체 ' + s.sellers.length + '명</div></div>';
    if (s.unsettledDays && s.unsettledDays.length) {
      html += '<div class="alert alert-warn">정산을 만들지 않은 발송일: ' + esc(s.unsettledDays.join(', ')) +
        '\n시트에서 [주문관리 → 정산 만들기]를 눌러야 미입금에 들어갑니다.</div>';
    }
    if (!s.sellers.length) html += '<div class="card empty">판사가 없습니다.</div>';
    s.sellers.forEach(function (x) {
      var meta = !x.active ? '사용 중지된 판사' : x.unpaid > 0 ? '미입금 ' + x.unpaidDays + '일' : '미입금 없음';
      if (x.lastPaid) meta += ' · 마지막 입금 ' + x.lastPaid;
      html += '<a class="card seller-row" href="#s/' + encodeURIComponent(x.id) + '">' +
        '<div class="seller-main"><div class="order-title">' + esc(x.name) + '</div>' +
        (x.payer && x.payer !== x.name ? '<div class="order-meta">입금자명 ' + esc(x.payer) + '</div>' : '') +
        '<div class="order-meta">' + esc(meta) + '</div></div>' +
        '<div class="seller-amount' + (x.unpaid > 0 ? ' due' : ' clear') + '">' + esc(won(x.unpaid)) + '</div></a>';
    });
    html += '<div class="center"><button class="link-btn" id="refreshBtn">새로고침</button> · ' +
      '<button class="link-btn" id="logoutBtn">이 기기에서 관리자 코드 지우기</button></div>';
    app.innerHTML = html;
    document.getElementById('refreshBtn').onclick = function () { state.summaryAt = 0; renderHome(); };
    document.getElementById('logoutBtn').onclick = function () {
      if (window.confirm('이 기기에 저장된 관리자 코드를 지울까요?')) logout();
    };
  }

  // 판사 상세에서 입금 확인을 바꾸면 첫 화면 요약의 그 판사 줄도 맞춘다
  function patchSummary(d) {
    if (!state.summary) return;
    var total = 0;
    state.summary.sellers.forEach(function (x) {
      if (x.id === d.id) { x.unpaid = d.unpaid; x.unpaidDays = d.unpaidDays; x.lastPaid = d.lastPaid; }
      total += x.unpaid;
    });
    state.summary.total = total;
    state.summary.sellers.sort(function (a, b) { return b.unpaid - a.unpaid || (a.name < b.name ? -1 : 1); });
    saveSummary();
  }

  // ───────── 판사 상세: 정산일별 입금 확인 ─────────
  function renderSeller(id, navigated) {
    var cached = state.details[id];
    if (cached) drawSeller(cached, '<div class="stale"><span class="spinner"></span>새로고침 중</div>', navigated);
    else app.innerHTML = '<div class="loading">정산을 불러오는 중…</div>';
    api('adminSeller', { sellerId: id }).then(function (res) {
      if (currentTab() !== 'seller' || decodeURIComponent(location.hash.slice(3)) !== id) return;
      if (res.ok) {
        state.details[id] = res.detail;
        patchSummary(res.detail);
        return drawSeller(res.detail, '', navigated && !cached);
      }
      if (res.auth === false) return;
      app.innerHTML = '<a class="link-btn back" href="#home">← 판사 목록</a>' +
        '<div class="card"><div class="alert alert-error">' + esc(res.error) + '</div>' +
        '<button class="btn btn-block" id="reloadSeller">다시 시도</button></div>';
      document.getElementById('reloadSeller').onclick = function () { renderSeller(id); };
    });
  }

  function drawSeller(d, statusHtml, scrollToUnpaid) {
    var html = statusHtml + '<a class="link-btn back" href="#home">← 판사 목록</a>' +
      '<div class="card"><div class="order-title">' + esc(d.name) + ' <span class="sub">' + esc(d.id) + '</span></div>' +
      (d.payer && d.payer !== d.name ? '<div class="order-meta">입금자명 ' + esc(d.payer) + '</div>' : '') +
      '<div class="sub" style="margin-top:8px">미입금 합계</div>' +
      '<div class="settle-amount' + (d.unpaid > 0 ? ' due' : '') + '">' + esc(won(d.unpaid)) + '</div>' +
      '<div class="order-meta">' + (d.unpaid > 0 ? '미입금 ' + d.unpaidDays + '일' : '미입금 없음') +
      (d.lastPaid ? ' · 마지막 입금 ' + esc(d.lastPaid) : '') + '</div></div>';
    if (!d.rows.length) html += '<div class="card empty">아직 정산이 없습니다.</div>';
    d.rows.forEach(function (x, i) {
      html += '<div class="card settle-row' + (x.paid ? ' paid' : '') + '" id="row' + i + '">' +
        '<div class="order-top"><div class="order-title">' + esc(x.label) + ' 정산 · 발송 ' + esc(x.count) + '건</div>' +
        '<div class="row-amount">' + esc(won(x.amount)) + '</div></div>' +
        (x.noPrice ? '<div class="order-meta warn-text">단가 미정 ' + esc(x.noPrice) + '건은 금액에서 빠져 있습니다</div>' : '');
      if (x.paid) {
        html += '<div class="paid-line">✓ ' + esc(x.paidDay ? x.paidDay + ' ' : '') + '입금 확인' + (x.by ? ' · ' + esc(x.by) : '') +
          ' <button class="link-btn" data-act="unpay" data-i="' + i + '">되돌리기</button></div>';
      } else {
        html += '<div class="order-meta">미입금 누적 <b class="due">' + esc(won(x.cum)) + '</b></div>' +
          '<div class="row-btns"><button class="btn-primary" data-act="pay" data-i="' + i + '">입금 확인</button>' +
          (x.cum > x.amount ? '<button data-act="through" data-i="' + i + '">여기까지 모두</button>' : '') + '</div>';
      }
      html += '<details><summary>정산 문구 보기</summary><pre class="settle-text">' + esc(x.text) + '</pre>' +
        '<button class="btn-small" data-act="copy" data-i="' + i + '">복사</button></details></div>';
    });
    app.innerHTML = html;
    app.onclick = function (e) {
      var btn = e.target.closest ? e.target.closest('button[data-act]') : null;
      if (btn) onSellerAction(d, btn);
    };
    if (scrollToUnpaid) {
      var first = -1;
      d.rows.forEach(function (x, i) { if (first < 0 && !x.paid) first = i; });
      var el = first >= 0 ? document.getElementById('row' + first) : null;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    }
  }

  function onSellerAction(d, btn) {
    var x = d.rows[Number(btn.dataset.i)];
    var act = btn.dataset.act;
    if (act === 'copy') {
      copyText(x.text).then(function (ok) { btn.textContent = ok ? '복사됨' : '길게 눌러 직접 복사해 주세요'; });
      return;
    }
    var payload = { sellerId: d.id, day: x.day };
    var action = 'adminSetPaid';
    if (act === 'pay') {
      payload.paid = true;
    } else if (act === 'unpay') {
      if (!window.confirm(x.label + ' 정산의 입금 확인을 되돌릴까요?')) return;
      payload.paid = false;
    } else if (act === 'through') {
      var list = d.rows.filter(function (r) { return !r.paid && r.day <= x.day; });
      if (!window.confirm(list[0].label + ' ~ ' + x.label + ' 정산 ' + list.length + '건, 합계 ' + won(x.cum) + '을 모두 입금 확인할까요?')) return;
      action = 'adminPayThrough';
    } else {
      return;
    }
    Array.prototype.forEach.call(app.querySelectorAll('button[data-act]'), function (b) { if (b !== btn && b.dataset.act !== 'copy') b.disabled = true; });
    setBusy(btn, true, '저장 중');
    api(action, payload).then(function (res) {
      if (res.ok) {
        state.details[d.id] = res.detail;
        patchSummary(res.detail);
        if (currentTab() === 'seller') drawSeller(res.detail, '');
      } else if (res.auth !== false) {
        window.alert(res.error);
        if (currentTab() === 'seller') drawSeller(d, '');
      }
    });
  }

  // ───────── 대신 주문 넣기 ─────────
  function renderOrder() {
    app.onclick = null;
    if (!state.summary) { app.innerHTML = '<div class="loading">불러오는 중…</div>'; return; }
    if (state.orderView === 'confirm') return renderOrderConfirm();
    if (state.orderView === 'done') return renderOrderDone();
    renderOrderForm();
  }

  function sellerName(id) {
    var s = state.summary.activeSellers.filter(function (x) { return x.id === id; })[0];
    return s ? s.name : '';
  }

  function renderOrderForm(errors) {
    errors = errors || {};
    var d = state.draft;
    var err = function (k) { return errors[k] ? '<div class="field-error">' + esc(errors[k]) + '</div>' : ''; };
    var cls = function (k) { return errors[k] ? 'invalid' : ''; };
    app.innerHTML =
      '<div class="notice">판사가 개인톡으로 보낸 주문을 대신 넣습니다. 주문번호·접수일시는 자동으로 들어가고, 시트 비고에 "대리입력(' + esc(state.admin.name) + ')"이 남습니다. 판사의 내 주문에도 보입니다.</div>' +
      '<form class="card" id="orderForm" novalidate>' +
      '<div class="frow"><label for="seller">판사</label>' +
      '<select id="seller" class="' + cls('seller') + '"><option value="">판사를 고르세요</option>' +
      state.summary.activeSellers.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (s.id === state.sellerId ? ' selected' : '') + '>' + esc(s.name) + ' (' + esc(s.id) + ')</option>';
      }).join('') + '</select>' + err('seller') + '</div>' +
      '<div class="frow frow-item">' +
      '<div class="fcell"><label for="item">품목</label><input id="item" value="' + esc(d.item) + '" maxlength="50" placeholder="판사가 쓴 그대로" class="' + cls('item') + '">' + err('item') + '</div>' +
      '<div class="fcell"><label for="qty">수량</label><div class="qty"><button type="button" id="qtyMinus" aria-label="수량 줄이기">−</button>' +
      '<input id="qty" inputmode="numeric" value="' + esc(d.qty) + '" class="' + cls('qty') + '">' +
      '<button type="button" id="qtyPlus" aria-label="수량 늘리기">+</button></div>' + err('qty') + '</div></div>' +
      '<div class="frow frow-half">' +
      '<div class="fcell"><label for="name">받는 분</label><input id="name" value="' + esc(d.name) + '" maxlength="20" autocomplete="off" placeholder="이름" class="' + cls('name') + '">' + err('name') + '</div>' +
      '<div class="fcell"><label for="phone">연락처</label><input id="phone" type="tel" inputmode="numeric" value="' + esc(d.phone) + '" placeholder="010-0000-0000" autocomplete="off" class="' + cls('phone') + '">' + err('phone') + '</div></div>' +
      '<div class="frow"><label for="address">주소</label><textarea id="address" maxlength="100" placeholder="도로명 또는 지번 주소, 동·호수까지" class="' + cls('address') + '">' + esc(d.address) + '</textarea>' + err('address') + '</div>' +
      '<div class="frow"><label for="memo">배송 메모 <span class="opt">(선택)</span></label><input id="memo" value="' + esc(d.memo) + '" maxlength="100"></div>' +
      '<div class="frow"><label for="etc">기타 <span class="opt">(선택)</span></label><textarea id="etc" maxlength="200" rows="2">' + esc(d.etc) + '</textarea></div>' +
      '<button class="btn btn-primary btn-block" type="submit">주문 넣기</button>' +
      '</form>';

    var qty = document.getElementById('qty');
    var phone = document.getElementById('phone');
    document.getElementById('qtyMinus').onclick = function () { qty.value = Math.max(1, (parseInt(qty.value, 10) || 1) - 1); };
    document.getElementById('qtyPlus').onclick = function () { qty.value = Math.min(999, (parseInt(qty.value, 10) || 0) + 1); };
    qty.addEventListener('input', function () { qty.value = digits(qty.value).slice(0, 3); });
    phone.addEventListener('input', function () { phone.value = formatPhoneLive(phone.value); });
    document.getElementById('orderForm').onsubmit = function (e) {
      e.preventDefault();
      var v = function (id) { return document.getElementById(id).value; };
      state.sellerId = v('seller');
      state.draft = {
        item: v('item').trim(),
        qty: parseInt(v('qty'), 10) || 0,
        name: v('name').replace(/\s+/g, ' ').trim(),
        phone: formatPhoneLive(v('phone')),
        address: v('address').replace(/\s+/g, ' ').trim(),
        memo: v('memo').replace(/\s+/g, ' ').trim(),
        etc: v('etc').replace(/\s+/g, ' ').trim(),
      };
      var dd = state.draft;
      var errs = {};
      if (!state.sellerId) errs.seller = '판사를 골라 주세요.';
      if (!dd.item) errs.item = '품목을 입력해 주세요.';
      if (!(dd.qty >= 1 && dd.qty <= 999)) errs.qty = '1 이상';
      if (!dd.name) errs.name = '이름을 입력해 주세요.';
      if (!validPhone(dd.phone)) errs.phone = '번호를 확인해 주세요.';
      if (dd.address.length < 5) errs.address = '주소를 동·호수까지 입력해 주세요.';
      if (Object.keys(errs).length) {
        renderOrderForm(errs);
        var first = document.querySelector('.invalid');
        if (first) first.focus();
        return;
      }
      state.requestId = newRequestId();
      state.orderView = 'confirm';
      renderOrder();
      window.scrollTo(0, 0);
    };
  }

  function renderOrderConfirm(alertHtml, dupAsk) {
    var d = state.draft;
    app.innerHTML =
      '<div class="card"><h2>대신 넣을 주문을 확인해 주세요</h2>' + (alertHtml || '') +
      '<table class="summary">' +
      '<tr><th>판사</th><td><b>' + esc(sellerName(state.sellerId)) + '</b> (' + esc(state.sellerId) + ')</td></tr>' +
      '<tr><th>품목</th><td>' + esc(d.item) + '</td></tr>' +
      '<tr><th>수량</th><td>' + esc(d.qty) + '</td></tr>' +
      '<tr><th>받는 분</th><td>' + esc(d.name) + '</td></tr>' +
      '<tr><th>연락처</th><td>' + esc(d.phone) + '</td></tr>' +
      '<tr><th>주소</th><td>' + esc(d.address) + '</td></tr>' +
      (d.memo ? '<tr><th>배송 메모</th><td>' + esc(d.memo) + '</td></tr>' : '') +
      (d.etc ? '<tr><th>기타</th><td>' + esc(d.etc) + '</td></tr>' : '') +
      '</table><div class="row-btns"><button type="button" id="editBtn">고치기</button>' +
      '<button type="button" class="btn-primary" id="submitBtn">' + (dupAsk ? '그래도 넣기' : '확정') + '</button></div></div>';
    document.getElementById('editBtn').onclick = function () { state.orderView = 'form'; renderOrder(); };
    document.getElementById('submitBtn').onclick = function () { submitOrder(!!dupAsk); };
  }

  function submitOrder(force) {
    setBusy(document.getElementById('submitBtn'), true, '저장 중');
    document.getElementById('editBtn').disabled = true;
    // 주문이 몰리거나 연결이 잠깐 끊기면 같은 요청 ID로 두 번까지 자동 재시도한다 (두 번 저장되지 않음)
    var payload = { sellerId: state.sellerId, order: state.draft, force: force, requestId: state.requestId };
    var attempt = function (left) {
      return api('adminOrder', payload).then(function (res) {
        if ((res.busy || res.network) && left > 0) {
          return new Promise(function (r) { setTimeout(r, 1500 + Math.random() * 1500); }).then(function () { return attempt(left - 1); });
        }
        return res;
      });
    };
    attempt(2).then(function (res) {
      if (res.ok) {
        state.lastResult = { orderNo: res.orderNo, seller: sellerName(state.sellerId), item: state.draft.item, name: state.draft.name };
        state.draft = emptyDraft(); // 같은 판사 주문이 이어지는 경우가 많아 판사는 남긴다
        state.orderView = 'done';
        renderOrder();
      } else if (res.dup) {
        renderOrderConfirm('<div class="alert alert-warn">' + esc(res.error) + '</div>', true);
      } else if (res.auth !== false) {
        renderOrderConfirm('<div class="alert alert-error">' + esc(res.error) + '</div>', force);
      }
    });
  }

  function renderOrderDone() {
    var r = state.lastResult;
    app.innerHTML =
      '<div class="card center"><div class="done-mark">✓</div><h2>대신 넣었습니다</h2>' +
      '<div class="order-no">' + esc(r.orderNo) + '</div>' +
      '<p class="sub">' + esc(r.seller) + ' · ' + esc(r.name) + ' · ' + esc(r.item) + '</p>' +
      '<button class="btn btn-primary btn-block" id="againBtn">' + esc(r.seller) + '님 주문 이어서 넣기</button>' +
      '<button class="btn btn-block" id="otherBtn">다른 판사 주문 넣기</button></div>';
    document.getElementById('againBtn').onclick = function () { state.orderView = 'form'; renderOrder(); window.scrollTo(0, 0); };
    document.getElementById('otherBtn').onclick = function () { state.sellerId = ''; state.orderView = 'form'; renderOrder(); window.scrollTo(0, 0); };
  }

  route();
})();
