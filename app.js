/* coroom — 회의실 예약 시스템 프론트엔드 */
(function () {
  "use strict";

  const CFG = window.COROOM_CONFIG;
  const OPEN = CFG.OPEN_HOUR;          // 09
  const CLOSE = CFG.CLOSE_HOUR;        // 19
  const HOUR_H = 56;                   // 시간 한 칸 높이(px)
  const PX_PER_MIN = HOUR_H / 60;
  const HOURS = CLOSE - OPEN;

  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  // 상태
  let rooms = [];
  let currentDate = todayStr();
  let dayReservations = [];   // 선택 날짜의 확정 예약
  let detailTarget = null;    // 상세 모달에서 보고 있는 예약

  // DOM
  const board = document.getElementById("board");
  const statusEl = document.getElementById("status");
  const datePicker = document.getElementById("datePicker");

  document.documentElement.style.setProperty("--hour-h", HOUR_H + "px");

  /* ---------- 유틸 ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function toMin(t) {                 // "16:00" -> 960
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }
  function hhmm(t) { return t.slice(0, 5); }  // "16:00:00" -> "16:00"
  function dateLabel(s) {
    const [y, mo, d] = s.split("-").map(Number);
    const wk = ["일", "월", "화", "수", "목", "금", "토"][new Date(y, mo - 1, d).getDay()];
    return `${y}. ${mo}. ${d} (${wk})`;
  }
  function shiftDate(s, delta) {
    const [y, mo, d] = s.split("-").map(Number);
    const dt = new Date(y, mo - 1, d + delta);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  function setStatus(msg) { statusEl.textContent = msg; }

  /* ---------- 오프라인 캐시 ---------- */
  const LS_ROOMS = "coroom_rooms";
  const LS_RESV = "coroom_resv_map";   // { "YYYY-MM-DD": [...] }
  let offline = false;

  function cacheSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function cacheGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  const offlineTag = document.getElementById("offlineTag");
  function markOffline(state) {
    offline = state;
    offlineTag.classList.toggle("hidden", !state);
  }

  /* ---------- 데이터 ---------- */
  async function loadRooms() {
    try {
      const { data, error } = await sb.from("rooms").select("*").order("id");
      if (error) throw error;
      rooms = data;
      cacheSet(LS_ROOMS, data);
    } catch (e) {
      const cached = cacheGet(LS_ROOMS);
      if (cached && cached.length) { rooms = cached; markOffline(true); }
      else { setStatus("회의실 정보를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요."); }
    }
  }

  async function loadReservations() {
    try {
      const { data, error } = await sb
        .from("reservations")
        .select("*")
        .eq("date", currentDate)
        .eq("status", "확정")
        .order("start_time");
      if (error) throw error;
      dayReservations = data;
      markOffline(false);
      // 날짜별로 마지막 조회 결과를 저장 → 오프라인에서도 마지막 화면 표시
      const map = cacheGet(LS_RESV) || {};
      map[currentDate] = data;
      cacheSet(LS_RESV, map);
    } catch (e) {
      const map = cacheGet(LS_RESV) || {};
      dayReservations = map[currentDate] || [];
      markOffline(true);
    }
  }

  async function nextReservationId() {
    const { data, error } = await sb
      .from("reservations")
      .select("id")
      .order("id", { ascending: false })
      .limit(1);
    const year = new Date().getFullYear();
    if (error || !data || !data.length) return `B${year}001`;
    const last = data[0].id;                 // 예: B2026095
    const prefix = last.slice(0, 5);         // "B2026"
    const seq = parseInt(last.slice(5), 10) + 1;
    return prefix + String(seq).padStart(3, "0");
  }

  /* ---------- 렌더링 ---------- */
  function render() {
    datePicker.value = currentDate;
    board.style.gridTemplateColumns = `70px repeat(${rooms.length}, minmax(130px, 1fr))`;
    board.innerHTML = "";

    // 헤더 행
    board.appendChild(el("div", "col-head time-head", ""));
    rooms.forEach((r) => {
      const head = el("div", "col-head");
      head.innerHTML =
        `<div class="rname">${escape(r.name)}</div>` +
        `<div class="rmeta">정원 ${r.capacity}명 · ${escape(r.floor)}</div>` +
        `<div class="rmeta">${escape(r.equipment || "")}</div>` +
        (r.note ? `<div class="rnote">${escape(r.note)}</div>` : "");
      board.appendChild(head);
    });

    // 시간축
    const axis = el("div", "time-axis");
    for (let h = OPEN; h < CLOSE; h++) {
      const lab = el("div", "time-label", `${pad(h)}:00`);
      axis.appendChild(lab);
    }
    board.appendChild(axis);

    // 회의실 컬럼
    rooms.forEach((r) => {
      const col = el("div", "room-col");

      // 클릭 가능한 시간 칸(빈 슬롯)
      for (let h = OPEN; h < CLOSE; h++) {
        const cell = el("div", "hour-cell");
        cell.dataset.hour = h;
        cell.addEventListener("click", () => openCreate(r, h));
        col.appendChild(cell);
      }

      // 예약 블록
      dayReservations
        .filter((rv) => rv.room_id === r.id)
        .forEach((rv) => col.appendChild(makeBlock(rv)));

      board.appendChild(col);
    });

    if (offline) {
      setStatus(`${dateLabel(currentDate)} · 확정 예약 ${dayReservations.length}건 — 오프라인 상태입니다. 마지막으로 불러온 화면을 보여드려요.`);
    } else {
      setStatus(`${dateLabel(currentDate)} · 확정 예약 ${dayReservations.length}건 — 빈 칸을 클릭하면 예약할 수 있어요.`);
    }
  }

  function makeBlock(rv) {
    const s = toMin(rv.start_time), e = toMin(rv.end_time);
    const top = (s - OPEN * 60) * PX_PER_MIN;
    const height = Math.max(22, (e - s) * PX_PER_MIN - 2);
    const b = el("div", "resv-block");
    b.style.top = top + "px";
    b.style.height = height + "px";
    b.innerHTML =
      `<div class="rb-title">${escape(rv.title)}</div>` +
      `<div class="rb-sub">${hhmm(rv.start_time)}–${hhmm(rv.end_time)} · ${escape(rv.reserver)}</div>`;
    b.addEventListener("click", (ev) => { ev.stopPropagation(); openDetail(rv); });
    return b;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function escape(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- 예약 생성 모달 ---------- */
  const createModal = document.getElementById("createModal");
  const createForm = document.getElementById("createForm");
  const createError = document.getElementById("createError");
  const createSubmit = document.getElementById("createSubmit");
  const startSel = document.getElementById("f_start");
  const endSel = document.getElementById("f_end");
  let createContext = null; // { room }

  function fillTimeOptions() {
    const opts = [];
    for (let h = OPEN; h <= CLOSE; h++) {
      for (const m of [0, 30]) {
        if (h === CLOSE && m > 0) continue;
        opts.push(`${pad(h)}:${pad(m)}`);
      }
    }
    startSel.innerHTML = opts.slice(0, -1).map((t) => `<option value="${t}">${t}</option>`).join("");
    endSel.innerHTML = opts.slice(1).map((t) => `<option value="${t}">${t}</option>`).join("");
  }

  function openCreate(room, hour) {
    if (offline || !navigator.onLine) {
      alert("오프라인 상태에서는 예약할 수 없어요. 인터넷 연결 후 다시 시도해 주세요.");
      return;
    }
    createContext = { room };
    createError.classList.add("hidden");
    document.getElementById("f_roomName").textContent = room.name;
    document.getElementById("f_dateLabel").textContent = dateLabel(currentDate);
    document.getElementById("f_roomMeta").textContent =
      `정원 ${room.capacity}명 · ${room.floor} · ${room.equipment || ""}` +
      (room.note ? ` · ${room.note}` : "");
    const start = `${pad(hour)}:00`;
    const end = `${pad(Math.min(hour + 1, CLOSE))}:00`;
    startSel.value = start;
    endSel.value = end;
    document.getElementById("f_reserver").value = "";
    document.getElementById("f_department").value = "";
    document.getElementById("f_title").value = "";
    createModal.classList.remove("hidden");
    document.getElementById("f_reserver").focus();
  }

  // 클라이언트측 겹침 검사
  function overlapsExisting(roomId, startMin, endMin) {
    return dayReservations.some((rv) =>
      rv.room_id === roomId &&
      startMin < toMin(rv.end_time) &&
      endMin > toMin(rv.start_time));
  }

  createForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    createError.classList.add("hidden");

    const room = createContext.room;
    const start = startSel.value, end = endSel.value;
    const reserver = document.getElementById("f_reserver").value.trim();
    const department = document.getElementById("f_department").value.trim();
    const title = document.getElementById("f_title").value.trim();

    if (toMin(end) <= toMin(start)) { return showCreateError("종료 시간은 시작 시간보다 뒤여야 합니다."); }
    if (!reserver || !department || !title) { return showCreateError("모든 항목을 입력해 주세요."); }
    if (overlapsExisting(room.id, toMin(start), toMin(end))) {
      return showCreateError("이미 예약된 시간대와 겹칩니다.");
    }

    createSubmit.disabled = true; createSubmit.textContent = "예약 중…";
    try {
      const id = await nextReservationId();
      const { error } = await sb.from("reservations").insert({
        id, room_id: room.id, reserver, department, title,
        date: currentDate, start_time: start, end_time: end, status: "확정",
      });
      if (error) {
        if (error.code === "23P01" || /no_overlap/.test(error.message)) {
          return showCreateError("이미 예약된 시간대입니다. 다른 시간을 선택해 주세요.");
        }
        return showCreateError("예약에 실패했습니다: " + error.message);
      }
      closeModals();
      await refresh();
    } finally {
      createSubmit.disabled = false; createSubmit.textContent = "예약하기";
    }
  });

  function showCreateError(msg) {
    createError.textContent = msg;
    createError.classList.remove("hidden");
  }

  /* ---------- 예약 상세 / 취소 ---------- */
  const detailModal = document.getElementById("detailModal");
  const detailList = document.getElementById("detailList");
  const detailError = document.getElementById("detailError");
  const cancelBtn = document.getElementById("cancelResvBtn");

  function openDetail(rv) {
    detailTarget = rv;
    detailError.classList.add("hidden");
    const room = rooms.find((r) => r.id === rv.room_id);
    const badge = rv.status === "확정"
      ? '<span class="badge confirmed">확정</span>'
      : '<span class="badge cancelled">취소</span>';
    detailList.innerHTML = `
      <dt>예약번호</dt><dd>${escape(rv.id)}</dd>
      <dt>회의실</dt><dd>${escape(room ? room.name : rv.room_id)}</dd>
      <dt>날짜</dt><dd>${dateLabel(rv.date)}</dd>
      <dt>시간</dt><dd>${hhmm(rv.start_time)} – ${hhmm(rv.end_time)}</dd>
      <dt>회의제목</dt><dd>${escape(rv.title)}</dd>
      <dt>예약자</dt><dd>${escape(rv.reserver)} (${escape(rv.department)})</dd>
      <dt>상태</dt><dd>${badge}</dd>`;
    cancelBtn.style.display = rv.status === "확정" ? "" : "none";
    detailModal.classList.remove("hidden");
  }

  cancelBtn.addEventListener("click", async () => {
    if (!detailTarget) return;
    detailError.classList.add("hidden");
    cancelBtn.disabled = true; cancelBtn.textContent = "취소 중…";
    try {
      const { error } = await sb.from("reservations")
        .update({ status: "취소" }).eq("id", detailTarget.id);
      if (error) {
        detailError.textContent = "취소에 실패했습니다: " + error.message;
        detailError.classList.remove("hidden");
        return;
      }
      closeModals();
      await refresh();
    } finally {
      cancelBtn.disabled = false; cancelBtn.textContent = "예약 취소";
    }
  });

  /* ---------- 모달 공통 ---------- */
  function closeModals() {
    createModal.classList.add("hidden");
    detailModal.classList.add("hidden");
    detailTarget = null;
  }
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
  [createModal, detailModal].forEach((m) =>
    m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModals(); });

  /* ---------- 날짜 네비게이션 ---------- */
  document.getElementById("prevDay").addEventListener("click", () => { currentDate = shiftDate(currentDate, -1); refresh(); });
  document.getElementById("nextDay").addEventListener("click", () => { currentDate = shiftDate(currentDate, 1); refresh(); });
  document.getElementById("todayBtn").addEventListener("click", () => { currentDate = todayStr(); refresh(); });
  datePicker.addEventListener("change", () => { if (datePicker.value) { currentDate = datePicker.value; refresh(); } });

  /* ---------- 새로고침 / 초기화 ---------- */
  async function refresh() {
    await loadReservations();
    render();
  }

  /* ---------- 온라인/오프라인 감지 ---------- */
  window.addEventListener("online", () => { markOffline(false); refresh(); });
  window.addEventListener("offline", () => { markOffline(true); render(); });

  /* ---------- "홈 화면에 추가" 안내 배너 ---------- */
  (function initInstallPrompt() {
    const banner = document.getElementById("installBanner");
    const ibInstall = document.getElementById("ibInstall");
    const ibClose = document.getElementById("ibClose");
    const ibHint = document.getElementById("ibHint");
    if (!banner) return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    const dismissed = localStorage.getItem("coroom_install_dismissed") === "1";
    if (isStandalone || dismissed) return;   // 이미 설치했거나 닫았으면 표시 안 함

    let deferredPrompt = null;

    function show() { banner.classList.remove("hidden"); }
    function hide() { banner.classList.add("hidden"); }

    // Android / Chrome 계열: 네이티브 설치 프롬프트 사용
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      show();
    });

    ibInstall.addEventListener("click", async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      hide();
    });

    ibClose.addEventListener("click", () => {
      hide();
      localStorage.setItem("coroom_install_dismissed", "1");
    });

    window.addEventListener("appinstalled", () => {
      hide();
      localStorage.setItem("coroom_install_dismissed", "1");
    });

    // iOS Safari: beforeinstallprompt 미지원 → 수동 안내 표시
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isIOSSafari = isIOS && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    if (isIOSSafari) {
      ibInstall.style.display = "none";
      ibHint.innerHTML =
        '하단 <b>공유 <span aria-hidden="true">⬆️</span></b> 버튼 → <b>홈 화면에 추가</b>를 눌러 설치하세요.';
      show();
    }
  })();

  async function init() {
    fillTimeOptions();
    setStatus("불러오는 중…");
    await loadRooms();
    if (!rooms.length) return;
    await refresh();

    // 실시간 반영 (다른 사용자의 예약 변경 시 현재 날짜 갱신)
    sb.channel("reservations-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" },
        () => refresh())
      .subscribe();
  }

  init();
})();
