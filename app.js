/* ═══════════════════════════════════════════════════════════════
   App Logic — Tugas LMS Telkom University (iOS Style)
   ═══════════════════════════════════════════════════════════════ */

const LMS_URL = 'https://lms.telkomuniversity.ac.id';

function getCleanIcalUrl() {
  const fromConfig = (window.CONFIG?.ICAL_URL || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').trim();
  const fromStorage = (localStorage.getItem('lms_ical_url') || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').trim();
  // Selalu utamakan config.js jika ada, sinkronkan ke localStorage
  const finalUrl = fromConfig || fromStorage || '';
  if (fromConfig && fromConfig !== fromStorage) {
    localStorage.setItem('lms_ical_url', fromConfig);
  }
  return finalUrl;
}

let state = {
  icalUrl: getCleanIcalUrl(),
  token: localStorage.getItem('lms_token') || (window.CONFIG?.MOODLE_TOKEN || '').trim() || null,
  user: JSON.parse(localStorage.getItem('lms_user') || 'null'),
  completedTasks: JSON.parse(localStorage.getItem('lms_completed_ids') || '[]'),
  pendingTasks: [],
  currentFilter: 'all',
};

// ── Call Moodle through backend proxy ──────────────────────────
async function callMoodle(wsfunction, params = {}) {
  const res = await fetch('/api/moodle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: state.token,
      wsfunction,
      params,
    }),
  });

  const data = await res.json();
  if (data && (data.errorcode || data.error)) {
    throw new Error(data.message || data.error || data.errorcode);
  }
  return data;
}

// ── Init & Auto-Load ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (window.CONFIG?.NAMA && !state.user) {
    state.user = { fullname: window.CONFIG.NAMA };
  }
  updateGreeting();
  updateUserInfo();

  // 1. Cek iCal URL di config.js atau localStorage
  const activeIcal = getCleanIcalUrl();
  if (activeIcal) {
    state.icalUrl = activeIcal;
    loadTasksViaIcal(activeIcal);
    return;
  }

  // 2. Cek token Moodle
  if (state.token) {
    loadTasksViaMoodleApi();
    return;
  }

  // 3. Cek kredensial SSO di config.js
  if (window.CONFIG?.SSO_USERNAME && window.CONFIG?.SSO_PASSWORD) {
    await autoLoginSSO(window.CONFIG.SSO_USERNAME, window.CONFIG.SSO_PASSWORD);
    return;
  }

  // 4. Jika belum ada config, tampilkan instruksi ramah
  showNoConfigNotice();
});

function showNoConfigNotice() {
  const taskList = document.getElementById('taskList');
  const skeleton = document.getElementById('skeletonLoader');
  skeleton.style.display = 'none';

  taskList.innerHTML = `
    <div style="background:var(--bg-elevated);border:1px solid var(--separator);border-radius:var(--radius-lg);padding:24px 20px;text-align:center;animation:slideUp 0.4s ease;">
      <div style="font-size:44px;margin-bottom:12px;">⚙️</div>
      <h3 style="font-size:18px;font-weight:700;margin-bottom:8px;">Belum Ada Konfigurasi</h3>
      <p style="font-size:14px;color:var(--text-secondary);line-height:1.5;margin-bottom:18px;">
        Silakan isi link iCal di file <code style="color:var(--accent);background:var(--bg-secondary);padding:2px 6px;border-radius:4px;">public/config.js</code> atau ketuk tombol di bawah untuk memasukkannya langsung dari HP Anda.
      </p>
      <button class="btn-primary" onclick="openSettingsModal()" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;">
        <span>Buka Pengaturan URL iCal</span>
      </button>
    </div>
  `;
}

// ── Auto Login SSO jika diset di config.js ──────────────────────
async function autoLoginSSO(username, password) {
  try {
    updateProgress(30, 'Menghubungkan akun SSO...');
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.token) {
      state.token = data.token;
      localStorage.setItem('lms_token', data.token);
      await fetchUserInfo();
      loadTasksViaMoodleApi();
    } else {
      showNoConfigNotice();
    }
  } catch (err) {
    showNoConfigNotice();
  }
}

// ── Fetch User Info ────────────────────────────────────────────
async function fetchUserInfo() {
  try {
    const data = await callMoodle('core_webservice_get_site_info');
    state.user = {
      id: data.userid,
      fullname: data.fullname,
      username: data.username,
      sitename: data.sitename,
      userpictureurl: data.userpictureurl,
    };
    localStorage.setItem('lms_user', JSON.stringify(state.user));
    updateUserInfo();
  } catch (e) {
    if (!state.user) {
      state.user = { fullname: window.CONFIG?.NAMA || 'Mahasiswa' };
    }
  }
}

// ── Master Load Tasks Router ───────────────────────────────────
function loadTasks() {
  const activeIcal = state.icalUrl || (window.CONFIG?.ICAL_URL || '').trim();
  if (activeIcal) {
    loadTasksViaIcal(activeIcal);
  } else if (state.token) {
    loadTasksViaMoodleApi();
  } else {
    showNoConfigNotice();
  }
}

// ── 1. Load Tasks from iCal Feed (Cepat & Stabil) ──────────────
async function loadTasksViaIcal(url) {
  const taskList = document.getElementById('taskList');
  const skeleton = document.getElementById('skeletonLoader');
  const emptyState = document.getElementById('emptyState');
  const errorState = document.getElementById('errorState');
  const refreshBtn = document.getElementById('refreshBtn');
  const loadingProgress = document.getElementById('loadingProgress');

  taskList.style.display = '';
  skeleton.style.display = '';
  emptyState.style.display = 'none';
  errorState.style.display = 'none';
  loadingProgress.style.display = '';
  refreshBtn.classList.add('spinning');
  taskList.querySelectorAll('.task-card').forEach((c) => c.remove());

  // Pastikan URL mengekspor semua tugas (preset_what=all) bukan hanya personal (user)
  let targetUrl = url;
  if (targetUrl.includes('preset_what=user')) {
    targetUrl = targetUrl.replace('preset_what=user', 'preset_what=all');
  }

  updateProgress(40, 'Membaca kalender iCal LMS Telkom...');

  try {
    const res = await fetch('/api/fetch-ical', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });

    const resText = await res.text();
    let data;

    try {
      data = JSON.parse(resText);
    } catch (parseErr) {
      if (!res.ok) {
        throw new Error(`Server error (${res.status}): Periksa koneksi ke server.`);
      }
      throw new Error(`Format respon tidak sesuai. Pastikan server aktif.`);
    }

    if (!data.success) {
      throw new Error(data.error || 'Gagal membaca kalender iCal.');
    }

    updateProgress(100, 'Memproses tugas...');
    state.pendingTasks = data.tasks || [];

    finishLoading();
    updateSummary();
    renderTasks();
  } catch (err) {
    console.error('Error loadTasksViaIcal:', err);
    finishLoading();
    errorState.style.display = '';
    
    let userMsg = err.message || 'Gagal memuat iCal.';
    if (userMsg.includes('Load failed') || userMsg.includes('Failed to fetch')) {
      userMsg = 'Tidak dapat terhubung ke server. Pastikan HP dan Laptop terhubung ke Wi-Fi yang sama, atau website sudah di-deploy ke Vercel.';
    } else if (userMsg.includes('pattern')) {
      userMsg = 'Respon server tidak terbaca. Silakan ketuk Coba Lagi.';
    }
    
    document.getElementById('errorMsg').textContent = userMsg;
  }
}

// ── 2. Load Tasks from Moodle API (Jika Pakai Token) ───────────
async function loadTasksViaMoodleApi() {
  const taskList = document.getElementById('taskList');
  const skeleton = document.getElementById('skeletonLoader');
  const emptyState = document.getElementById('emptyState');
  const errorState = document.getElementById('errorState');
  const refreshBtn = document.getElementById('refreshBtn');
  const loadingProgress = document.getElementById('loadingProgress');

  taskList.style.display = '';
  skeleton.style.display = '';
  emptyState.style.display = 'none';
  errorState.style.display = 'none';
  loadingProgress.style.display = '';
  refreshBtn.classList.add('spinning');
  taskList.querySelectorAll('.task-card').forEach((c) => c.remove());

  try {
    updateProgress(15, 'Mengambil mata kuliah...');
    const courses = await callMoodle('core_enrol_get_users_courses', {
      userid: state.user?.id,
    });

    if (!Array.isArray(courses) || courses.length === 0) {
      finishLoading();
      emptyState.style.display = '';
      return;
    }

    updateProgress(35, `Mengambil tugas dari ${courses.length} mata kuliah...`);
    const courseParams = {};
    courses.forEach((c, i) => {
      courseParams[`courseids[${i}]`] = c.id;
    });

    const assignData = await callMoodle('mod_assign_get_assignments', courseParams);
    const allAssignments = [];
    (assignData.courses || []).forEach((course) => {
      (course.assignments || []).forEach((a) => {
        allAssignments.push({
          id: String(a.id),
          cmid: a.cmid,
          courseId: course.id,
          courseName: course.fullname || course.shortname,
          name: a.name,
          intro: a.intro,
          duedate: a.duedate,
          url: `${LMS_URL}/mod/assign/view.php?id=${a.cmid}`,
          submissionStatus: 'nosubmission'
        });
      });
    });

    if (allAssignments.length === 0) {
      finishLoading();
      emptyState.style.display = '';
      return;
    }

    updateProgress(50, `Memeriksa status ${allAssignments.length} tugas...`);
    const pending = [];
    const batchSize = 4;

    for (let i = 0; i < allAssignments.length; i += batchSize) {
      const batch = allAssignments.slice(i, i + batchSize);
      const pct = 50 + Math.round((i / allAssignments.length) * 45);
      updateProgress(pct, `Mengecek status tugas (${i + 1}/${allAssignments.length})...`);

      const statusPromises = batch.map((a) =>
        callMoodle('mod_assign_get_submission_status', {
          assignid: a.id,
          userid: state.user?.id,
        }).catch(() => null)
      );

      const statuses = await Promise.all(statusPromises);

      batch.forEach((a, idx) => {
        const statusData = statuses[idx];
        const submissionStatus = statusData?.lastattempt?.submission?.status || 'nosubmission';
        if (submissionStatus === 'new' || submissionStatus === 'nosubmission') {
          pending.push({ ...a, submissionStatus });
        }
      });
    }

    pending.sort((a, b) => {
      if (a.duedate === 0 && b.duedate === 0) return 0;
      if (a.duedate === 0) return 1;
      if (b.duedate === 0) return -1;
      return a.duedate - b.duedate;
    });

    updateProgress(100, 'Selesai!');
    state.pendingTasks = pending;

    finishLoading();
    updateSummary();
    renderTasks();
  } catch (err) {
    finishLoading();
    if (err.message?.includes('Invalid token') || err.message?.includes('accessexception')) {
      handleLogout();
      return;
    }
    errorState.style.display = '';
    document.getElementById('errorMsg').textContent = err.message || 'Gagal memuat tugas.';
  }
}

// Alias for refresh button
function loadPendingTasks() {
  loadTasks();
}

function finishLoading() {
  document.getElementById('skeletonLoader').style.display = 'none';
  document.getElementById('refreshBtn').classList.remove('spinning');
  setTimeout(() => {
    document.getElementById('loadingProgress').style.display = 'none';
  }, 400);
}

function updateProgress(pct, text) {
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('loadingText').textContent = text;
}

// ── Summary Cards ──────────────────────────────────────────────
function updateSummary() {
  const now = Math.floor(Date.now() / 1000);
  const dayInSec = 86400;
  const weekInSec = dayInSec * 7;

  // Saring tugas yang belum ditandai selesai secara lokal
  const uncompleted = state.pendingTasks.filter((t) => !state.completedTasks.includes(String(t.id)));

  const urgent = uncompleted.filter(
    (t) => t.duedate > 0 && t.duedate - now > 0 && t.duedate - now < dayInSec
  ).length;
  const overdue = uncompleted.filter(
    (t) => t.duedate > 0 && t.duedate < now
  ).length;
  const thisWeek = uncompleted.filter(
    (t) => t.duedate > 0 && t.duedate - now > 0 && t.duedate - now < weekInSec
  ).length;

  animateNumber('urgentCount', urgent + overdue);
  animateNumber('pendingCount', uncompleted.length);
  animateNumber('upcomingCount', thisWeek);
}

function animateNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  if (start === target) return;
  const duration = 400;
  const startTime = performance.now();
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ── Render Tasks ───────────────────────────────────────────────
function renderTasks() {
  const taskList = document.getElementById('taskList');
  const emptyState = document.getElementById('emptyState');
  const errorState = document.getElementById('errorState');

  taskList.querySelectorAll('.task-card').forEach((c) => c.remove());
  emptyState.style.display = 'none';
  errorState.style.display = 'none';

  const filtered = filterTaskData(state.pendingTasks, state.currentFilter);

  if (filtered.length === 0) {
    emptyState.style.display = '';
    return;
  }

  filtered.forEach((task, i) => {
    const card = createTaskCard(task, i);
    taskList.appendChild(card);
  });
}

function filterTaskData(tasks, filter) {
  const now = Math.floor(Date.now() / 1000);
  const dayInSec = 86400;
  const weekInSec = dayInSec * 7;

  // Hanya tampilkan yang belum ditandai selesai (kecuali filter 'completed')
  const uncompleted = tasks.filter((t) => !state.completedTasks.includes(String(t.id)));

  switch (filter) {
    case 'overdue':
      return uncompleted.filter((t) => t.duedate > 0 && t.duedate < now);
    case 'urgent':
      return uncompleted.filter(
        (t) => t.duedate > 0 && (t.duedate < now || (t.duedate - now > 0 && t.duedate - now < dayInSec))
      );
    case 'thisweek':
      return uncompleted.filter(
        (t) => t.duedate > 0 && t.duedate > now && t.duedate - now < weekInSec
      );
    case 'nodue':
      return uncompleted.filter((t) => !t.duedate || t.duedate === 0);
    default:
      return uncompleted;
  }
}

function filterTasks(filter, chipEl) {
  state.currentFilter = filter;
  document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
  chipEl.classList.add('active');
  renderTasks();
}

// ── Create Task Card with iOS Checkbox ─────────────────────────
function createTaskCard(task, index) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.style.animationDelay = `${index * 0.05}s`;

  const now = Math.floor(Date.now() / 1000);
  const deadline = getDeadlineInfo(task.duedate, now);
  const isDone = state.completedTasks.includes(String(task.id));

  card.innerHTML = `
    <div class="task-card-top">
      <div class="task-check-circle" onclick="toggleTaskCompletion('${task.id}', event)" title="Tandai selesai">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:${isDone ? 'block' : 'none'};"/></svg>
      </div>
      <div class="task-card-info" onclick="openTaskDetailById('${task.id}')">
        <div class="task-course">${escapeHtml(shortenCourseName(task.courseName))}</div>
        <div class="task-name">${escapeHtml(task.name)}</div>
        <div class="task-meta">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span>${deadline.text}</span>
        </div>
      </div>
      <div class="deadline-badge ${deadline.class}">${deadline.badge}</div>
    </div>
    ${deadline.progressHtml}
  `;

  return card;
}

// ── Toggle Completion (Tap Lingkaran Checklist) ────────────────
function toggleTaskCompletion(taskId, event) {
  event.stopPropagation();
  taskId = String(taskId);

  if (state.completedTasks.includes(taskId)) {
    state.completedTasks = state.completedTasks.filter((id) => id !== taskId);
  } else {
    state.completedTasks.push(taskId);
  }

  localStorage.setItem('lms_completed_ids', JSON.stringify(state.completedTasks));
  updateSummary();
  renderTasks();
}

function resetCompletedTasks() {
  if (confirm('Tampilkan kembali semua tugas yang sudah Anda tandai selesai?')) {
    state.completedTasks = [];
    localStorage.removeItem('lms_completed_ids');
    updateSummary();
    renderTasks();
    closeSettingsModal();
  }
}

// ── Deadline Calculations ──────────────────────────────────────
function getDeadlineInfo(duedate, now) {
  if (!duedate || duedate === 0) {
    return { text: 'Tanpa deadline', badge: '∞', class: 'nodue', progressHtml: '' };
  }

  const diff = duedate - now;
  const absDiff = Math.abs(diff);
  const hours = Math.floor(absDiff / 3600);
  const days = Math.floor(absDiff / 86400);
  const mins = Math.floor(absDiff / 60);

  let text, badge, cls, progressPct;

  if (diff < 0) {
    if (days > 0) text = `Terlambat ${days} hari`;
    else if (hours > 0) text = `Terlambat ${hours} jam`;
    else text = `Terlambat ${mins} menit`;
    badge = 'Lewat!';
    cls = 'overdue';
    progressPct = 100;
  } else if (diff < 3600) {
    text = `${mins} menit lagi`;
    badge = `${mins}m`;
    cls = 'urgent';
    progressPct = 95;
  } else if (diff < 86400) {
    text = `${hours} jam lagi`;
    badge = `${hours}j`;
    cls = 'urgent';
    progressPct = 80;
  } else if (diff < 86400 * 3) {
    text = `${days} hari lagi`;
    badge = `${days}h`;
    cls = 'soon';
    progressPct = 50;
  } else if (diff < 86400 * 7) {
    text = `${days} hari lagi`;
    badge = `${days}h`;
    cls = 'safe';
    progressPct = 25;
  } else {
    text = formatDate(duedate);
    badge = `${days}h`;
    cls = 'safe';
    progressPct = 10;
  }

  const barColor =
    cls === 'overdue' ? 'var(--red)' :
    cls === 'urgent' ? 'var(--orange)' :
    cls === 'soon' ? 'var(--yellow)' : 'var(--green)';

  const progressHtml = `
    <div class="task-progress">
      <div class="task-progress-bar" style="width:${progressPct}%; background:${barColor}"></div>
    </div>
  `;

  return { text, badge, class: cls, progressHtml };
}

function formatDate(ts) {
  const d = new Date(ts * 1000);
  const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateLong(ts) {
  const d = new Date(ts * 1000);
  const days = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const months = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} — ${pad(d.getHours())}:${pad(d.getMinutes())} WIB`;
}

function pad(n) { return String(n).padStart(2, '0'); }

// ── Detail Modal ───────────────────────────────────────────────
function openTaskDetailById(taskId) {
  const task = state.pendingTasks.find((t) => String(t.id) === String(taskId));
  if (task) openTaskDetail(task);
}

function openTaskDetail(task) {
  const modal = document.getElementById('taskModal');
  const now = Math.floor(Date.now() / 1000);
  const deadline = getDeadlineInfo(task.duedate, now);

  document.getElementById('modalTitle').textContent = task.name;
  document.getElementById('modalCourse').textContent = task.courseName;
  document.getElementById('modalDeadline').textContent =
    task.duedate ? formatDateLong(task.duedate) : 'Tidak ada deadline';

  const timeLeftEl = document.getElementById('modalTimeLeft');
  timeLeftEl.textContent = deadline.text;
  timeLeftEl.className = `detail-value ${
    deadline.class === 'overdue' ? 'text-red' :
    deadline.class === 'urgent' ? 'text-orange' :
    deadline.class === 'soon' ? 'text-yellow' : 'text-green'
  }`;

  document.getElementById('modalStatus').textContent = '❌ Belum selesai';

  const desc = document.getElementById('modalDescription');
  desc.innerHTML = task.intro ? sanitizeHtml(task.intro) : '';

  const link = document.getElementById('modalLink');
  let targetUrl = task.url;
  if (!targetUrl) {
    if (task.cmid) {
      targetUrl = `${LMS_URL}/mod/assign/view.php?id=${task.cmid}`;
    } else if (task.id && task.id.includes('@')) {
      const eventId = task.id.split('@')[0];
      targetUrl = `${LMS_URL}/calendar/view.php?view=event&id=${eventId}`;
    } else {
      targetUrl = `${LMS_URL}/calendar/view.php`;
    }
  }
  link.href = targetUrl;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('taskModal').classList.remove('open');
  document.body.style.overflow = '';
}

// ── Settings Modal ─────────────────────────────────────────────
function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  const input = document.getElementById('settingsIcalUrl');
  input.value = getCleanIcalUrl();
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSettingsModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('settingsModal').classList.remove('open');
  document.body.style.overflow = '';
}

function saveSettingsFromModal() {
  const input = document.getElementById('settingsIcalUrl');
  const newUrl = (input.value || '').replace(/[\s\u200B-\u200D\uFEFF]/g, '').trim();
  state.icalUrl = newUrl;
  localStorage.setItem('lms_ical_url', newUrl);
  closeSettingsModal();
  loadTasks();
}

// ── iCal Export Modal ──────────────────────────────────────────
async function openIcalModal() {
  const modal = document.getElementById('icalModal');
  const body = document.getElementById('icalBody');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  const activeIcal = state.icalUrl || (window.CONFIG?.ICAL_URL || '').trim();

  if (activeIcal) {
    const webcalUrl = activeIcal.replace(/^https?:\/\//i, 'webcal://');
    const gcalUrl = 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(activeIcal);

    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:18px;">
        <div style="background:var(--bg-secondary);padding:14px;border-radius:var(--radius-md);font-size:13px;line-height:1.5;color:var(--text-secondary);">
          💡 <strong style="color:#fff;">Sinkron ke Kalender iPhone</strong><br/>
          Ketuk tombol di bawah agar kalender LMS otomatis terhubung ke aplikasi Kalender bawaan iPhone.
        </div>

        <a href="${webcalUrl}" class="btn-primary" style="text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px;">
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" stroke-width="2"/></svg>
          <span>Langganan di Apple Calendar</span>
        </a>

        <div style="display:flex;gap:8px;">
          <button class="btn-secondary" style="flex:1;" onclick="copyToClipboard('${activeIcal}', this)">
            📋 Salin URL iCal
          </button>
          <a href="${gcalUrl}" target="_blank" class="btn-secondary" style="flex:1;text-decoration:none;display:flex;align-items:center;justify-content:center;">
            🌐 Google Calendar
          </a>
        </div>

        <div style="background:var(--bg-elevated);border:1px solid var(--separator);border-radius:var(--radius-sm);padding:10px 12px;font-size:11px;color:var(--text-tertiary);word-break:break-all;font-family:monospace;">
          ${activeIcal}
        </div>
      </div>
    `;
    return;
  }

  // Jika tidak ada iCal URL tapi ada token, ambil lewat backend
  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:30px;gap:12px;color:var(--text-secondary);">
      <div class="spinner"></div>
      <span>Mengambil link iCal kalender Anda...</span>
    </div>
  `;

  try {
    const res = await fetch('/api/ical-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.token,
        userid: state.user?.id
      })
    });
    const data = await res.json();

    if (data.urls?.semua_mendatang) {
      const uUrl = data.urls.semua_mendatang;
      const wUrl = data.webcal_urls.semua_mendatang;
      body.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:18px;">
          <a href="${wUrl}" class="btn-primary" style="text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px;">
            <span>Langganan di Apple Calendar</span>
          </a>
          <button class="btn-secondary" onclick="copyToClipboard('${uUrl}', this)">📋 Salin URL iCal</button>
          <div style="font-size:11px;color:var(--text-tertiary);word-break:break-all;">${uUrl}</div>
        </div>
      `;
    } else {
      body.innerHTML = `
        <div style="padding:16px;text-align:center;">
          <p style="color:var(--text-secondary);margin-bottom:12px;">Masukkan URL iCal Anda di file <code>public/config.js</code> atau menu Pengaturan ⚙️.</p>
        </div>
      `;
    }
  } catch (e) {
    body.innerHTML = `<div style="padding:16px;color:var(--red);">Gagal mengambil iCal.</div>`;
  }
}

function closeIcalModal(event) {
  if (event && event.target !== event.currentTarget) return;
  document.getElementById('icalModal').classList.remove('open');
  document.body.style.overflow = '';
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ Disalin!';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  }).catch(() => {
    prompt('Salin link ini:', text);
  });
}

// ── Reset Data ─────────────────────────────────────────────────
function handleLogout() {
  if (!confirm('Hapus sesi dan reset data di browser ini?')) return;
  state.token = null;
  state.user = null;
  state.icalUrl = '';
  state.pendingTasks = [];
  state.completedTasks = [];
  localStorage.clear();
  location.reload();
}

// ── User Info & Greeting ───────────────────────────────────────
function updateGreeting() {
  const hour = new Date().getHours();
  let greeting;
  if (hour < 5) greeting = 'Selamat Malam 🌙';
  else if (hour < 12) greeting = 'Selamat Pagi ☀️';
  else if (hour < 15) greeting = 'Selamat Siang 🌤️';
  else if (hour < 18) greeting = 'Selamat Sore 🌅';
  else greeting = 'Selamat Malam 🌙';
  document.getElementById('greetingText').textContent = greeting;
}

function updateUserInfo() {
  const name = state.user?.fullname || window.CONFIG?.NAMA || 'Mahasiswa';
  document.getElementById('userName').textContent = name;

  const avatar = document.getElementById('userAvatar');
  if (state.user?.userpictureurl) {
    avatar.innerHTML = `<img src="${state.user.userpictureurl}" alt="avatar" onerror="this.parentElement.textContent='${getInitials(name)}'" />`;
  } else {
    avatar.textContent = getInitials(name);
  }
}

function getInitials(name) {
  if (!name) return 'TU';
  return name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

function shortenCourseName(name) {
  if (!name) return '';
  return name.replace(/^\[.*?\]\s*/, '').replace(/^\d{4}\/\d{1,2}\s*[-–—]\s*/, '').trim();
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sanitizeHtml(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  temp.querySelectorAll('script, style, iframe, object, embed').forEach((el) => el.remove());
  temp.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (attr.name.startsWith('on') || attr.name === 'style') {
        el.removeAttribute(attr.name);
      }
    });
  });
  return temp.innerHTML;
}

function shakeElement(el) {
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake 0.4s ease';
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  btn.querySelector('.btn-text').style.display = loading ? 'none' : '';
  btn.querySelector('.btn-loader').style.display = loading ? 'flex' : 'none';
}

const style = document.createElement('style');
style.textContent = `@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}`;
document.head.appendChild(style);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
    closeIcalModal();
    closeSettingsModal();
  }
});
