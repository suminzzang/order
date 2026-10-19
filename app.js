(function () {
  'use strict';

  // ───────── 설정 · 저장소 ─────────
  var CFG = window.ORDER_CONFIG || { shops: {} };
  var params = new URLSearchParams(location.search);
  var shopKey = params.get('s') || CFG.defaultShop || Object.keys(CFG.shops)[0] || 'default';
  var apiUrl = CFG.shops[shopKey];
  var isMock = !apiUrl || apiUrl === 'mock';
  var CODE_KEY = 'okc:' + shopKey + ':code';
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
    seller: null,
    config: null,
    draft: emptyDraft(),
    requestId: '',
    lastResult: null,
    loginError: '',
  };

  function emptyDraft(keepItem) {
    return { item: keepItem || '', qty: 1, name: '', phone: '', address: '', memo: '', etc: '' };
  }

  var app = document.getElementById('app');

  // ───────── API ─────────
  function api(action, extra) {
    var body = Object.assign({ action: action, code: state.code }, extra || {});
    var timer = null;
    var request;
    if (isMock) {
      request = window.MockApi.call(body);
    } else {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 25000) : null;
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
      if (res && res.auth === false) {
        state.code = '';
        state.seller = null;
        storeSet(CODE_KEY, '');
        state.loginError = res.error;
        route();
      }
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

  // 입력 중에도 보기 좋게 하이픈을 넣는다
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

  function renderHeader() {
    var shop = state.config && state.config.shopName;
    document.getElementById('shopName').textContent = shop ? shop + ' 주문서' : '주문서';
    document.title = shop ? shop + ' 주문서' : '주문서';
    document.getElementById('whoName').textContent = state.seller ? state.seller.name + '님' : '';
    document.getElementById('tabs').hidden = !state.seller;
    document.getElementById('mockBadge').hidden = !isMock;
    var tab = currentTab();
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), function (a) {
      a.classList.toggle('on', a.dataset.tab === tab);
    });
  }

  function currentTab() {
    var h = location.hash.replace('#', '');
    return h === 'orders' || h === 'me' ? h : 'order';
  }

  // ───────── 라우팅 ─────────
  var view = 'order'; // order | confirm | done

  function route() {
    renderHeader();
    if (!state.code) return renderLogin();
    if (!state.seller) return boot();
    var tab = currentTab();
    if (tab === 'orders') return renderOrders();
    if (tab === 'me') return renderMe();
    if (view === 'confirm') return renderConfirm();
    if (view === 'done') return renderDone();
    return renderForm();
  }

  window.addEventListener('hashchange', function () {
    if (currentTab() === 'order' && view === 'done') view = 'order';
    route();
    window.scrollTo(0, 0);
  });

  function boot() {
    app.innerHTML = '<div class="loading">불러오는 중…</div>';
    api('login').then(function (res) {
      if (res.ok) {
        state.seller = res.seller;
        state.config = res.config;
        route();
      } else if (res.auth !== false) {
        app.innerHTML = '<div class="card"><div class="alert alert-error">' + esc(res.error) + '</div>' +
          '<button class="btn btn-primary btn-block" id="retry">다시 시도</button></div>';
        document.getElementById('retry').onclick = boot;
      }
    });
  }

  // ───────── 판사 코드 입력 ─────────
  function renderLogin() {
    app.innerHTML =
      '<div class="card">' +
      '<h1>판사 코드 입력</h1>' +
      '<p class="sub">운영자에게 받은 8자리 판사 코드를 입력해 주세요. 처음 한 번만 입력하면 다음부터는 바로 주문서가 열립니다.</p>' +
      (state.loginError ? '<div class="alert alert-error">' + esc(state.loginError) + '</div>' : '') +
      '<form id="loginForm" novalidate>' +
      '<input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="00000000" aria-label="판사 코드">' +
      '<button class="btn btn-primary btn-block" id="loginBtn" type="submit">확인</button>' +
      '</form>' +
      (isMock ? '<p class="sub center" style="margin-top:14px">체험용 코드: 12345678</p>' : '') +
      '</div>';
    var input = document.getElementById('code');
    input.addEventListener('input', function () { input.value = digits(input.value).slice(0, 8); });
    document.getElementById('loginForm').onsubmit = function (e) {
      e.preventDefault();
      var code = digits(input.value);
      if (code.length !== 8) {
        state.loginError = '판사 코드는 숫자 8자리입니다.';
        return renderLogin();
      }
      var btn = document.getElementById('loginBtn');
      setBusy(btn, true, '확인 중');
      state.code = code;
      api('login').then(function (res) {
        if (res.ok) {
          storeSet(CODE_KEY, code);
          state.seller = res.seller;
          state.config = res.config;
          state.loginError = '';
          route();
        } else if (res.auth !== false) {
          state.code = '';
          state.loginError = res.error;
          renderLogin();
        }
      });
    };
    setTimeout(function () { input.focus(); }, 50);
  }

  // ───────── 주문 입력 ─────────
  function renderForm(errors) {
    errors = errors || {};
    var c = state.config;
    var d = state.draft;
    var itemField;
    if (c.itemMode === 'dropdown') {
      itemField = '<select id="item" class="' + (errors.item ? 'invalid' : '') + '">' +
        '<option value="">품목을 고르세요</option>' +
        c.items.map(function (it) {
          return '<option' + (it === d.item ? ' selected' : '') + '>' + esc(it) + '</option>';
        }).join('') + '</select>';
    } else {
      itemField = '<input id="item" value="' + esc(d.item) + '" maxlength="50" placeholder="예: 사과 5kg" class="' + (errors.item ? 'invalid' : '') + '">';
    }
    var err = function (k) { return errors[k] ? '<div class="field-error">' + esc(errors[k]) + '</div>' : ''; };

    // 품목·수량, 받는 분·연락처는 한 줄에 둬서 화면을 덜 차지하게 한다
    app.innerHTML =
      '<form class="card" id="orderForm" novalidate>' +
      '<div class="frow frow-item">' +
      '<div class="fcell"><label for="item">품목</label>' + itemField + err('item') + '</div>' +
      '<div class="fcell"><label for="qty">수량</label>' +
      '<div class="qty"><button type="button" id="qtyMinus" aria-label="수량 줄이기">−</button>' +
      '<input id="qty" inputmode="numeric" value="' + esc(d.qty) + '" class="' + (errors.qty ? 'invalid' : '') + '">' +
      '<button type="button" id="qtyPlus" aria-label="수량 늘리기">+</button></div>' + err('qty') + '</div>' +
      '</div>' +
      '<div class="frow frow-half">' +
      '<div class="fcell"><label for="name">받는 분</label>' +
      '<input id="name" value="' + esc(d.name) + '" maxlength="20" autocomplete="off" placeholder="이름" class="' + (errors.name ? 'invalid' : '') + '">' + err('name') + '</div>' +
      '<div class="fcell"><label for="phone">연락처</label>' +
      '<input id="phone" type="tel" inputmode="numeric" value="' + esc(d.phone) + '" placeholder="010-0000-0000" autocomplete="off" class="' + (errors.phone ? 'invalid' : '') + '">' + err('phone') + '</div>' +
      '</div>' +
      '<div class="frow">' +
      '<label for="address">주소</label>' +
      '<textarea id="address" maxlength="100" placeholder="도로명 또는 지번 주소, 동·호수까지" class="' + (errors.address ? 'invalid' : '') + '">' + esc(d.address) + '</textarea>' + err('address') +
      '</div>' +
      '<div class="frow">' +
      '<label for="memo">배송 메모 <span class="opt">(선택)</span></label>' +
      '<input id="memo" value="' + esc(d.memo) + '" maxlength="100" placeholder="예: 문 앞에 놓아주세요">' +
      '</div>' +
      '<div class="frow">' +
      '<label for="etc">기타 <span class="opt">(선택)</span></label>' +
      '<textarea id="etc" maxlength="200" rows="2" placeholder="예: 현금영수증 요청 (번호 010-0000-0000)">' + esc(d.etc) + '</textarea>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" type="submit">주문 넣기</button>' +
      (c.notice ? '<p class="form-foot">' + esc(c.notice) + '</p>' : '') +
      '</form>';

    var qty = document.getElementById('qty');
    var phone = document.getElementById('phone');
    document.getElementById('qtyMinus').onclick = function () { qty.value = Math.max(1, (parseInt(qty.value, 10) || 1) - 1); };
    document.getElementById('qtyPlus').onclick = function () { qty.value = Math.min(999, (parseInt(qty.value, 10) || 0) + 1); };
    qty.addEventListener('input', function () { qty.value = digits(qty.value).slice(0, 3); });
    phone.addEventListener('input', function () { phone.value = formatPhoneLive(phone.value); });

    document.getElementById('orderForm').onsubmit = function (e) {
      e.preventDefault();
      readForm();
      var errs = validate(state.draft);
      if (Object.keys(errs).length) {
        renderForm(errs);
        var first = document.querySelector('.invalid');
        if (first) first.focus();
        return;
      }
      state.requestId = newRequestId();
      view = 'confirm';
      route();
      window.scrollTo(0, 0);
    };
  }

  function readForm() {
    var v = function (id) { return document.getElementById(id).value; };
    state.draft = {
      item: v('item').trim(),
      qty: parseInt(v('qty'), 10) || 0,
      name: v('name').replace(/\s+/g, ' ').trim(),
      phone: formatPhoneLive(v('phone')),
      address: v('address').replace(/\s+/g, ' ').trim(),
      memo: v('memo').replace(/\s+/g, ' ').trim(),
      etc: v('etc').replace(/\s+/g, ' ').trim(),
    };
  }

  function validate(d) {
    var e = {};
    if (!d.item) e.item = state.config.itemMode === 'dropdown' ? '품목을 골라 주세요.' : '품목을 입력해 주세요.';
    if (!(d.qty >= 1 && d.qty <= 999)) e.qty = '1 이상';
    if (!d.name) e.name = '이름을 입력해 주세요.';
    if (!validPhone(d.phone)) e.phone = '번호를 확인해 주세요.';
    if (d.address.length < 5) e.address = '주소를 동·호수까지 입력해 주세요.';
    return e;
  }

  // ───────── 확인 ─────────
  function renderConfirm(alertHtml, dupAsk) {
    var d = state.draft;
    app.innerHTML =
      '<div class="card">' +
      '<h2>주문 내용을 확인해 주세요</h2>' +
      (alertHtml || '') +
      '<table class="summary">' +
      '<tr><th>품목</th><td>' + esc(d.item) + '</td></tr>' +
      '<tr><th>수량</th><td>' + esc(d.qty) + '</td></tr>' +
      '<tr><th>받는 분</th><td>' + esc(d.name) + '</td></tr>' +
      '<tr><th>연락처</th><td>' + esc(d.phone) + '</td></tr>' +
      '<tr><th>주소</th><td>' + esc(d.address) + '</td></tr>' +
      (d.memo ? '<tr><th>배송 메모</th><td>' + esc(d.memo) + '</td></tr>' : '') +
      (d.etc ? '<tr><th>기타</th><td>' + esc(d.etc) + '</td></tr>' : '') +
      '</table>' +
      '<div class="row-btns">' +
      '<button type="button" id="editBtn">고치기</button>' +
      '<button type="button" class="btn-primary" id="submitBtn">' + (dupAsk ? '그래도 넣기' : '확정') + '</button>' +
      '</div></div>';
    document.getElementById('editBtn').onclick = function () { view = 'order'; route(); };
    document.getElementById('submitBtn').onclick = function () { submit(!!dupAsk); };
  }

  function submit(force) {
    var btn = document.getElementById('submitBtn');
    var edit = document.getElementById('editBtn');
    setBusy(btn, true, '저장 중');
    edit.disabled = true;
    api('order', { order: state.draft, force: force, requestId: state.requestId }).then(function (res) {
      if (res.ok) {
        state.lastResult = { orderNo: res.orderNo, item: state.draft.item, name: state.draft.name };
        // 저장이 끝나면 바로 비운다. 다른 탭에 갔다 와도 방금 주문이 다시 채워져 있지 않게.
        // 같은 품목을 연달아 주문하는 경우가 많아 품목만 남긴다
        state.draft = emptyDraft(state.draft.item);
        view = 'done';
        route();
      } else if (res.dup) {
        renderConfirm('<div class="alert alert-warn">' + esc(res.error) + '</div>', true);
      } else if (res.auth !== false) {
        renderConfirm('<div class="alert alert-error">' + esc(res.error) + '</div>', force);
      }
    });
  }

  // ───────── 완료 ─────────
  function renderDone() {
    var r = state.lastResult;
    app.innerHTML =
      '<div class="card center">' +
      '<div class="done-mark">✓</div>' +
      '<h2>주문이 접수되었습니다</h2>' +
      '<div class="order-no">' + esc(r.orderNo) + '</div>' +
      '<p class="sub">' + esc(r.name) + ' · ' + esc(r.item) + '</p>' +
      '<p class="sub">송장번호가 입력되면 내 주문에서 "발송"으로 바뀝니다.</p>' +
      '<button class="btn btn-primary btn-block" id="againBtn">이어서 주문하기</button>' +
      '<a class="btn btn-block" href="#orders">내 주문 보기</a>' +
      '</div>';
    document.getElementById('againBtn').onclick = function () {
      view = 'order';
      route();
      window.scrollTo(0, 0);
      var name = document.getElementById('name');
      if (name) name.focus();
    };
  }

  // ───────── 내 주문 ─────────
  // 접수와 발송 사이에 운영자가 직접 상태를 갱신하므로, 주문서에서는 취소를 받지 않는다
  var CANCEL_NOTICE = '<div class="notice">주문 취소·변경 요청은 개인톡으로 문의해 주세요.</div>';

  function renderOrders() {
    app.innerHTML = '<div class="loading">주문을 불러오는 중…</div>';
    api('myOrders').then(function (res) {
      if (!res.ok) {
        if (res.auth === false) return;
        app.innerHTML = '<div class="card"><div class="alert alert-error">' + esc(res.error) + '</div>' +
          '<button class="btn btn-block" id="retry">다시 시도</button></div>';
        document.getElementById('retry').onclick = renderOrders;
        return;
      }
      if (!res.orders.length) {
        app.innerHTML = CANCEL_NOTICE + '<div class="card empty">최근 주문이 없습니다.</div>';
        return;
      }
      var html = '';
      var lastDay = '';
      res.orders.forEach(function (o) {
        var day = o.day ? o.day + ' 접수' : '';
        if (day !== lastDay) { html += '<div class="day">' + esc(day) + '</div>'; lastDay = day; }
        html += '<div class="card order-item">' +
          '<div class="order-top"><div class="order-title">' + esc(o.name) + ' · ' + esc(o.item) + ' × ' + esc(o.qty) + '</div>' +
          '<span class="badge badge-' + esc(o.status) + '">' + esc(o.status) + '</span></div>' +
          (o.requested ? '<div class="order-meta">요청: ' + esc(o.requested) + '</div>' : '') +
          '<div class="order-meta">' + esc(o.orderNo) + ' · ' + esc(o.at) + ' 접수' +
          (o.tracking ? ' · 송장 ' + esc(o.tracking) : '') + '</div>' +
          '</div>';
      });
      app.innerHTML = CANCEL_NOTICE + html;
    });
  }

  // ───────── 내 정보 ─────────
  function renderMe(msg) {
    app.innerHTML =
      '<div class="card">' +
      '<h2>내 정보</h2>' +
      (msg || '') +
      '<form id="renameForm" novalidate>' +
      '<label for="newName">표시 이름</label>' +
      '<input id="newName" maxlength="20" value="' + esc(state.seller.name) + '">' +
      '<p class="sub" style="margin-top:8px">이름을 바꿔도 지난 주문과 정산은 그대로 이어집니다.</p>' +
      '<button class="btn btn-primary btn-block" id="renameBtn" type="submit">이름 저장</button>' +
      '</form></div>' +
      '<div class="center"><button class="link-btn" id="logoutBtn">다른 판사 코드로 들어가기</button></div>';
    document.getElementById('renameForm').onsubmit = function (e) {
      e.preventDefault();
      var name = document.getElementById('newName').value.replace(/\s+/g, ' ').trim();
      if (!name) return renderMe('<div class="alert alert-error">이름을 입력해 주세요.</div>');
      var btn = document.getElementById('renameBtn');
      setBusy(btn, true, '저장 중');
      api('rename', { name: name }).then(function (res) {
        if (res.ok) {
          state.seller = res.seller;
          renderHeader();
          renderMe('<div class="alert" style="background:#e8f5e9;color:#1b5e20">이름을 저장했습니다.</div>');
        } else if (res.auth !== false) {
          renderMe('<div class="alert alert-error">' + esc(res.error) + '</div>');
        }
      });
    };
    document.getElementById('logoutBtn').onclick = function () {
      if (!window.confirm('이 휴대폰에 저장된 판사 코드를 지울까요?')) return;
      storeSet(CODE_KEY, '');
      state.code = '';
      state.seller = null;
      state.loginError = '';
      location.hash = '#order';
      route();
    };
  }

  route();
})();
