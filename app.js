// ============================================================
// BUILT-IN HABITS (PPL Split + Supplementary)
// ============================================================

const BUILT_IN_HABITS = [
  { id: 'gym_push_a', name: 'Push Session',        days: [1],             category: 'gym',      icon: '🏋️', label: 'Chest · Back · Deltas · Calves' },
  { id: 'mobility',   name: 'Mobility',             days: [1,2,3,4,5,6,0],category: 'mobility', icon: '🧘', label: '10 min' },
  { id: 'oah',        name: 'OAH / Handstand',      days: [1,2,4,5,6],    category: 'skill',    icon: '🤸', label: '15–20 min' },
  { id: 'gym_legs_a', name: 'Legs Session',         days: [2],             category: 'gym',      icon: '🦵', label: 'Quads · Glutes · Hamstrings' },
  { id: 'gym_pull_a', name: 'Pull Session',         days: [3],             category: 'gym',      icon: '💪', label: 'Back · Biceps' },
  { id: 'gym_push_b', name: 'Push Session',         days: [4],             category: 'gym',      icon: '🏋️', label: 'Chest · Triceps · Deltas · Calves' },
  { id: 'gym_pull_b', name: 'Pull Session',         days: [5],             category: 'gym',      icon: '💪', label: 'Posterior · Biceps · Deltas' },
  { id: 'hiit',       name: 'HIIT / Norwegian 4×4', days: [6],             category: 'cardio',   icon: '⚡', label: '~38 min' },
  { id: 'zone2',      name: 'Zone 2 Cardio',        days: [6, 0],          category: 'cardio',   icon: '🚴', label: '60 min' },
];

const CATEGORY_COLORS = {
  gym:      'var(--accent)',
  cardio:   'var(--warning)',
  mobility: 'var(--text-secondary)',
  skill:    'var(--purple)',
  custom:   'var(--blue)',
};

const CATEGORY_LABELS = {
  gym:      'Gym',
  cardio:   'Cardio',
  mobility: 'Mobility',
  skill:    'Skill',
  custom:   'Custom',
};

const PRESET_COLORS = [
  '#6ee7b7', // accent
  '#fbbf24', // warning
  '#f87171', // danger
  '#a78bfa', // purple
  '#60a5fa', // blue
  '#fb923c', // orange
];

const TAB_ORDER   = ['today', 'week', 'stats', 'split', 'settings'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ============================================================
// APP STATE
// ============================================================

const state = {
  activeTab: 'today',
  activeTabIndex: 0,
  statsSection: 'overview',
  splitView: 'fullweek',
  customHabits: [],
  hiddenBuiltins: new Set(),
  logsByDate: {},      // { "2024-05-20": { "gym_push_a": true, ... } }
  pendingQueue: [],    // offline queue
  isOnline: true,
  retryInterval: null,
  initialized: false,
  connectionOk: false,
};

// ============================================================
// UTILITIES
// ============================================================

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  const dow = (d.getDay() + 6) % 7; // Mon=0, Sun=6
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}

function friendlyDay(date) {
  if (isSameDay(date, today())) return 'Today';
  if (isSameDay(date, addDays(today(), -1))) return 'Yesterday';
  return DAY_FULL[date.getDay()];
}

// Returns all habits (built-in + custom) scheduled for a given date
function getHabitsForDate(date) {
  const dow = date.getDay(); // 0=Sun, 6=Sat
  const builtins = BUILT_IN_HABITS.filter(h =>
    h.days.includes(dow) && !state.hiddenBuiltins.has(h.id)
  );
  const customs = state.customHabits.filter(h =>
    h.active && h.days.includes(dow)
  );
  return [
    ...builtins,
    ...customs.map(c => ({
      id: c.id,
      name: c.name,
      days: c.days,
      category: 'custom',
      icon: '✦',
      label: 'Custom',
      color: c.color,
    })),
  ];
}

function getLogsForDate(dateStr) {
  return state.logsByDate[dateStr] || {};
}

function isCompleted(dateStr, habitId) {
  return !!(getLogsForDate(dateStr)[habitId]);
}

function computeStreak() {
  const todayStr = formatDate(today());
  let currentDate = new Date(today());
  let streak = 0;

  // If today has at least one habit logged, start counting from today,
  // otherwise start from yesterday
  const todayHabits = getHabitsForDate(today());
  const todayLogs = getLogsForDate(todayStr);
  const todayDone = todayHabits.some(h => todayLogs[h.id]);

  if (!todayDone) {
    currentDate = addDays(today(), -1);
  }

  for (let i = 0; i < 365; i++) {
    const dStr = formatDate(currentDate);
    const habits = getHabitsForDate(currentDate);
    if (habits.length === 0) {
      // No habits scheduled — skip this day (doesn't break streak)
      currentDate = addDays(currentDate, -1);
      continue;
    }
    const logs = getLogsForDate(dStr);
    const anyDone = habits.some(h => logs[h.id]);
    if (!anyDone) break;
    streak++;
    currentDate = addDays(currentDate, -1);
  }

  return streak;
}

function computeLongestStreak() {
  const end = today();
  const start = getNDaysAgo(365);
  let longest = 0;
  let current = 0;
  let d = new Date(start);

  while (d <= end) {
    const dStr = formatDate(d);
    const habits = getHabitsForDate(d);
    if (habits.length === 0) {
      d = addDays(d, 1);
      continue;
    }
    const logs = getLogsForDate(dStr);
    const anyDone = habits.some(h => logs[h.id]);
    if (anyDone) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
    d = addDays(d, 1);
  }
  return longest;
}

function computeHabitStreak(habitId) {
  let streak = 0;
  let d = new Date(today());

  // Check if today is scheduled for this habit
  const habit = [...BUILT_IN_HABITS, ...state.customHabits].find(h => h.id === habitId);
  if (!habit) return 0;

  const todayScheduled = habit.days.includes(today().getDay());
  const todayDone = isCompleted(formatDate(today()), habitId);

  if (todayScheduled && !todayDone) {
    d = addDays(d, -1);
  }

  for (let i = 0; i < 365; i++) {
    const scheduled = habit.days.includes(d.getDay());
    if (!scheduled) {
      d = addDays(d, -1);
      continue;
    }
    const dStr = formatDate(d);
    if (!isCompleted(dStr, habitId)) break;
    streak++;
    d = addDays(d, -1);
  }

  return streak;
}

function getWeeklyStats(numWeeks) {
  const result = [];
  const todayDate = today();
  const monday = getMondayOfWeek(todayDate);

  for (let w = numWeeks - 1; w >= 0; w--) {
    const weekStart = addDays(monday, -w * 7);
    let totalScheduled = 0;
    let totalCompleted = 0;

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (date > todayDate) break;
      const habits = getHabitsForDate(date);
      totalScheduled += habits.length;
      const logs = getLogsForDate(formatDate(date));
      totalCompleted += habits.filter(h => logs[h.id]).length;
    }

    const pct = totalScheduled > 0 ? Math.round((totalCompleted / totalScheduled) * 100) : 0;
    const weekNum = numWeeks - w;
    result.push({
      label: `W${weekNum}`,
      pct,
      completed: totalCompleted,
      scheduled: totalScheduled,
      weekStart,
    });
  }

  return result;
}

function getDayStats(date) {
  const habits = getHabitsForDate(date);
  const logs = getLogsForDate(formatDate(date));
  const completed = habits.filter(h => logs[h.id]).length;
  return { total: habits.length, completed };
}

async function hashPin(pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message, type = 'default', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 220);
  }, duration);
}

// ============================================================
// MODAL
// ============================================================

function openModal(html, title = '') {
  const overlay = document.getElementById('modal-overlay');
  const wrapper = document.getElementById('modal-wrapper');
  const content = document.getElementById('modal-content');

  content.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${title}</span>
      <button class="modal-close" id="modal-close-btn" aria-label="Close">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="modal-body">${html}</div>
  `;

  overlay.classList.remove('hidden');
  wrapper.classList.remove('hidden');

  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  overlay.addEventListener('click', closeModal, { once: true });
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-wrapper').classList.add('hidden');
}

// ============================================================
// OFFLINE QUEUE
// ============================================================

function queueSync(dateStr, habitId, completed) {
  // Remove any existing entry for same date+habit
  state.pendingQueue = state.pendingQueue.filter(
    o => !(o.date === dateStr && o.habitId === habitId)
  );
  state.pendingQueue.push({ date: dateStr, habitId, completed });
}

async function flushQueue() {
  if (state.pendingQueue.length === 0) return;
  const queue = [...state.pendingQueue];
  const failed = [];

  for (const op of queue) {
    const { error } = await dbUpsertLog(op.date, op.habitId, op.completed);
    if (error) {
      failed.push(op);
    }
  }

  state.pendingQueue = failed;

  if (failed.length === 0 && !state.isOnline) {
    setOnline(true);
  }
}

function setOnline(online) {
  state.isOnline = online;
  const banner = document.getElementById('offline-banner');
  if (online) {
    banner.classList.add('hidden');
  } else {
    banner.classList.remove('hidden');
  }
}

function startRetryInterval() {
  if (state.retryInterval) return;
  state.retryInterval = setInterval(async () => {
    if (state.pendingQueue.length > 0) {
      await flushQueue();
    }
  }, 30000);
}

// ============================================================
// TOGGLE HABIT (optimistic UI)
// ============================================================

async function toggleHabit(dateStr, habitId, currentState) {
  const newValue = !currentState;

  // Optimistic update
  if (!state.logsByDate[dateStr]) state.logsByDate[dateStr] = {};
  state.logsByDate[dateStr][habitId] = newValue;

  // Re-render today if this is today's date
  if (dateStr === formatDate(today())) {
    renderTodayHabits(today());
    updateProgressRing(today());
  }

  // Sync to Supabase
  const { error } = await dbUpsertLog(dateStr, habitId, newValue);

  if (error) {
    // Revert
    state.logsByDate[dateStr][habitId] = currentState;
    if (dateStr === formatDate(today())) {
      renderTodayHabits(today());
      updateProgressRing(today());
    }
    queueSync(dateStr, habitId, newValue);
    setOnline(false);
    showToast('Sync failed — will retry', 'error');
    startRetryInterval();
  }
}

// ============================================================
// CONFETTI
// ============================================================

function launchConfetti() {
  const container = document.getElementById('confetti-container');
  container.innerHTML = '';
  const colors = ['#6ee7b7', '#fbbf24', '#a78bfa', '#60a5fa', '#fb923c', '#f87171'];

  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const x = Math.random() * 100;
    const dx = (Math.random() - 0.5) * 120;
    const rot = Math.random() * 720 - 360;
    const dur = 0.9 + Math.random() * 0.8;
    const delay = Math.random() * 0.4;
    piece.style.cssText = `
      left: ${x}%;
      top: -10px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      --dx: ${dx}px;
      --rot: ${rot}deg;
      --dur: ${dur}s;
      --delay: ${delay}s;
      width: ${6 + Math.random() * 6}px;
      height: ${6 + Math.random() * 6}px;
      border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
    `;
    container.appendChild(piece);
  }

  setTimeout(() => { container.innerHTML = ''; }, 2500);
}

// ============================================================
// PROGRESS RING
// ============================================================

function updateProgressRing(date) {
  const { total, completed } = getDayStats(date);
  const ring = document.getElementById('progress-ring-fill');
  const label = document.getElementById('progress-ring-text');
  if (!ring || !label) return;

  const r = 20;
  const circumference = 2 * Math.PI * r;
  const pct = total > 0 ? completed / total : 0;
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference * (1 - pct);
  label.textContent = `${completed}/${total}`;
}

// ============================================================
// TAB NAVIGATION
// ============================================================

function switchTab(tabName, animate = true) {
  const newIndex = TAB_ORDER.indexOf(tabName);
  if (newIndex === -1) return;

  state.activeTab = tabName;
  state.activeTabIndex = newIndex;

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  if (window.innerWidth < 768) {
    // Mobile: move the slider to the correct pane
    const slider = document.getElementById('tab-slider');
    if (slider) {
      slider.style.transition = animate
        ? 'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        : 'none';
      slider.style.transform = `translateX(${-newIndex * window.innerWidth}px)`;
    }
  } else {
    // Desktop: classic show/hide
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
  }

  // Render tab content
  const renders = {
    today:    () => renderToday(today()),
    week:     () => renderWeek(),
    stats:    () => renderStats(),
    split:    () => renderSplit(),
    settings: () => renderSettings(),
  };
  if (renders[tabName]) renders[tabName]();
}

// ============================================================
// SWIPE NAVIGATION
// ============================================================

function initSwipe() {
  const slider = document.getElementById('tab-slider');
  if (!slider) return;

  let startX = 0, startY = 0;
  let deltaX = 0;
  let axisLocked = null; // 'h' | 'v' | null
  let startTime = 0;
  let dragging = false;

  slider.addEventListener('touchstart', (e) => {
    if (window.innerWidth >= 768) return;
    startX    = e.touches[0].clientX;
    startY    = e.touches[0].clientY;
    deltaX    = 0;
    axisLocked = null;
    dragging  = false;
    startTime = Date.now();
    // kill transition so drag follows finger exactly
    slider.style.transition = 'none';
  }, { passive: true });

  slider.addEventListener('touchmove', (e) => {
    if (window.innerWidth >= 768) return;

    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    // lock axis on first ≥ 8px of movement
    if (axisLocked === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        axisLocked = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      return; // wait until we know which axis
    }

    if (axisLocked !== 'h') return; // vertical — leave to browser

    dragging = true;
    deltaX = dx;

    // rubber-band resistance at first/last tab
    const idx = state.activeTabIndex;
    let effective = deltaX;
    if ((idx === 0 && deltaX > 0) || (idx === TAB_ORDER.length - 1 && deltaX < 0)) {
      effective = deltaX * 0.25;
    }

    const base = -state.activeTabIndex * window.innerWidth;
    slider.style.transform = `translateX(${base + effective}px)`;
  }, { passive: true });

  slider.addEventListener('touchend', () => {
    if (window.innerWidth >= 768) return;
    if (!dragging || axisLocked !== 'h') return;

    const elapsed = Math.max(1, Date.now() - startTime);
    const velocity = Math.abs(deltaX) / elapsed; // px/ms

    const shouldAdvance = Math.abs(deltaX) > 60 || velocity > 0.3;

    let newIndex = state.activeTabIndex;
    if (shouldAdvance) {
      if (deltaX < 0 && newIndex < TAB_ORDER.length - 1) newIndex++;
      else if (deltaX > 0 && newIndex > 0) newIndex--;
    }

    dragging = false;
    deltaX = 0;

    if (newIndex !== state.activeTabIndex) {
      switchTab(TAB_ORDER[newIndex]);
    } else {
      // snap back to current position
      slider.style.transition = 'transform 280ms cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      slider.style.transform = `translateX(${-state.activeTabIndex * window.innerWidth}px)`;
    }
  }, { passive: true });
}

// ============================================================
// TODAY TAB
// ============================================================

function renderToday(date) {
  const panel = document.getElementById('tab-today');
  const dateStr = formatDate(date);
  const isToday = isSameDay(date, today());
  const dayName = DAY_FULL[date.getDay()];
  const monthDay = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;

  const streak = computeStreak();

  panel.innerHTML = `
    <div class="today-header">
      <div class="today-date">
        <div class="today-day">${dayName}</div>
        <div class="today-dateline">${monthDay}</div>
      </div>
      <div class="today-meta">
        ${streak > 0 ? `
          <div class="streak-badge" id="streak-badge">
            🔥 <span class="streak-num" id="streak-num">${streak}</span>
            <span style="font-size:11px;color:var(--text-muted)">day${streak !== 1 ? 's' : ''}</span>
          </div>
        ` : ''}
        <div class="progress-ring-wrap">
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle class="progress-ring-bg" cx="26" cy="26" r="20"/>
            <circle class="progress-ring-fill" id="progress-ring-fill" cx="26" cy="26" r="20"
              stroke-dasharray="125.66" stroke-dashoffset="125.66"/>
          </svg>
          <div class="progress-ring-text" id="progress-ring-text">0/0</div>
        </div>
      </div>
    </div>

    <div id="habit-list-container"></div>

    ${isToday ? `
      <button class="log-past-btn" id="log-past-btn">↩ Log a past day</button>
    ` : ''}
  `;

  updateProgressRing(date);
  renderTodayHabits(date);

  if (isToday) {
    document.getElementById('log-past-btn').addEventListener('click', openLogPastDayModal);
  }
}

function renderTodayHabits(date) {
  const dateStr = formatDate(date);
  const habits = getHabitsForDate(date);
  const logs = getLogsForDate(dateStr);
  const container = document.getElementById('habit-list-container');
  if (!container) return;

  const incomplete = habits.filter(h => !logs[h.id]);
  const complete   = habits.filter(h => logs[h.id]);
  const sorted     = [...incomplete, ...complete];

  if (habits.length === 0) {
    container.innerHTML = `
      <div class="rest-day-label">Rest Day</div>
      <div class="all-done-msg">
        <span class="all-done-emoji">😴</span>
        No habits scheduled today. Enjoy the rest.
      </div>
    `;
    return;
  }

  const allDone = incomplete.length === 0;

  let html = `<div class="habit-list">`;
  for (const habit of sorted) {
    const done = !!logs[habit.id];
    const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';
    html += `
      <div class="habit-card ${done ? 'completed' : ''}" data-habit="${habit.id}" data-date="${dateStr}">
        <div class="habit-card-left">
          <div class="cat-dot" style="background:${color}"></div>
          <div class="habit-info">
            <div class="habit-name">${habit.name}</div>
            <div class="habit-category">${CATEGORY_LABELS[habit.category] || habit.category}${habit.label ? ' · ' + habit.label : ''}</div>
          </div>
        </div>
        <div class="habit-check" id="check-${habit.id}">
          <svg class="habit-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      </div>
    `;
  }
  html += `</div>`;

  if (allDone && complete.length > 0) {
    html += `
      <div class="all-done-msg">
        <span class="all-done-emoji">🎯</span>
        All done today!
      </div>
    `;
  }

  container.innerHTML = html;

  // Attach click handlers
  container.querySelectorAll('.habit-card').forEach(card => {
    card.addEventListener('click', () => {
      const habitId = card.dataset.habit;
      const dStr = card.dataset.date;
      const current = isCompleted(dStr, habitId);

      // Animate checkbox
      const check = card.querySelector('.habit-check');
      check.classList.add('pulse');
      check.addEventListener('animationend', () => check.classList.remove('pulse'), { once: true });

      toggleHabit(dStr, habitId, current).then(() => {
        // If just completed all habits, launch confetti
        const d = parseDate(dStr);
        const { total, completed } = getDayStats(d);
        if (total > 0 && completed === total) {
          launchConfetti();
        }
        updateProgressRing(d);
      });
    });
  });
}

function openLogPastDayModal() {
  const days = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(today(), -i);
    days.push(d);
  }

  let html = `<div class="past-day-picker">`;
  for (const d of days) {
    const habits = getHabitsForDate(d);
    const logs = getLogsForDate(formatDate(d));
    const done = habits.filter(h => logs[h.id]).length;
    const dStr = formatDate(d);
    html += `
      <button class="past-day-btn" data-date="${dStr}">
        <span>${friendlyDay(d)}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}</span>
        <span class="past-day-date">${habits.length > 0 ? `${done}/${habits.length}` : 'No habits'}</span>
      </button>
    `;
  }
  html += `</div>`;

  openModal(html, 'Log Past Day');

  document.querySelectorAll('.past-day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dateStr = btn.dataset.date;
      closeModal();
      openDayLogModal(parseDate(dateStr));
    });
  });
}

function openDayLogModal(date) {
  const dateStr = formatDate(date);
  const habits = getHabitsForDate(date);
  const logs = getLogsForDate(dateStr);
  const label = `${DAY_FULL[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;

  if (habits.length === 0) {
    openModal('<p style="color:var(--text-muted);text-align:center;padding:16px;">No habits scheduled this day.</p>', label);
    return;
  }

  const renderHabitRows = () => {
    return habits.map(habit => {
      const done = isCompleted(dateStr, habit.id);
      const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';
      return `
        <div class="habit-card ${done ? 'completed' : ''}" data-habit="${habit.id}" data-date="${dateStr}" style="margin-bottom:8px;">
          <div class="habit-card-left">
            <div class="cat-dot" style="background:${color}"></div>
            <div class="habit-info">
              <div class="habit-name">${habit.name}</div>
              <div class="habit-category">${CATEGORY_LABELS[habit.category] || habit.category}</div>
            </div>
          </div>
          <div class="habit-check" id="modal-check-${habit.id}">
            <svg class="habit-check-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        </div>
      `;
    }).join('');
  };

  const refreshModalBody = () => {
    const body = document.querySelector('.modal-body');
    if (body) body.innerHTML = renderHabitRows();
    attachModalHabitHandlers();
  };

  const attachModalHabitHandlers = () => {
    document.querySelectorAll('.modal-body .habit-card').forEach(card => {
      card.addEventListener('click', () => {
        const habitId = card.dataset.habit;
        const dStr = card.dataset.date;
        const current = isCompleted(dStr, habitId);
        toggleHabit(dStr, habitId, current).then(refreshModalBody);
      });
    });
  };

  openModal(renderHabitRows(), label);
  attachModalHabitHandlers();
}

// ============================================================
// WEEK TAB
// ============================================================

function renderWeek() {
  const panel = document.getElementById('tab-week');
  const todayDate = today();
  const monday = getMondayOfWeek(todayDate);

  let gridHtml = `<div class="week-grid">`;
  let weekCompleted = 0, weekTotal = 0;
  let bestDay = null, bestPct = -1;

  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const dateStr = formatDate(date);
    const isFuture = date > todayDate;
    const isToday = isSameDay(date, todayDate);
    const { total, completed } = getDayStats(date);

    if (!isFuture) {
      weekCompleted += completed;
      weekTotal += total;
      const pct = total > 0 ? completed / total : 0;
      if (pct > bestPct) { bestPct = pct; bestDay = date; }
    }

    const fillPct = total > 0 ? (completed / total) * 100 : 0;
    const colClass = `week-day-col${isToday ? ' today' : ''}${isFuture ? ' future' : ''}`;

    gridHtml += `
      <div class="${colClass}" data-date="${dateStr}">
        <div class="week-day-header">
          <div class="week-day-name">${DAY_NAMES[date.getDay()]}</div>
          <div class="week-day-num">${date.getDate()}</div>
        </div>
        <div class="week-day-body">
          <div class="week-fraction">${isFuture ? '—' : `${completed}/${total}`}</div>
          <div class="week-mini-bar">
            <div class="week-mini-bar-fill" style="width:${isFuture ? 0 : fillPct}%"></div>
          </div>
        </div>
      </div>
    `;
  }
  gridHtml += `</div>`;

  const weekPct = weekTotal > 0 ? Math.round((weekCompleted / weekTotal) * 100) : 0;
  const bestDayName = bestDay ? DAY_FULL[bestDay.getDay()] : '—';
  const bestStats = bestDay ? getDayStats(bestDay) : { completed: 0, total: 0 };

  panel.innerHTML = `
    ${gridHtml}
    <div class="week-summary-bar">
      <div class="week-summary-stat">
        This week: <strong>${weekCompleted}/${weekTotal} habits · ${weekPct}%</strong>
      </div>
      ${bestDay ? `<div class="week-summary-best">Best: ${bestDayName} (${bestStats.completed}/${bestStats.total})</div>` : ''}
    </div>
  `;

  // Tap past day to log
  panel.querySelectorAll('.week-day-col:not(.future)').forEach(col => {
    col.addEventListener('click', () => {
      const date = parseDate(col.dataset.date);
      openDayLogModal(date);
    });
  });
}

// ============================================================
// STATS TAB
// ============================================================

function renderStats() {
  const panel = document.getElementById('tab-stats');
  panel.innerHTML = `
    <div class="pill-nav" id="stats-pill-nav">
      <button class="pill-btn ${state.statsSection === 'overview' ? 'active' : ''}" data-section="overview">Overview</button>
      <button class="pill-btn ${state.statsSection === 'activity' ? 'active' : ''}" data-section="activity">Activity</button>
      <button class="pill-btn ${state.statsSection === 'insights' ? 'active' : ''}" data-section="insights">Insights</button>
    </div>
    <div id="stats-content"></div>
  `;

  panel.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.statsSection = btn.dataset.section;
      panel.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.dataset.section === state.statsSection));
      renderStatsSection(state.statsSection);
    });
  });

  renderStatsSection(state.statsSection);
}

function renderStatsSection(section) {
  const container = document.getElementById('stats-content');
  if (!container) return;
  if (section === 'overview') renderStatsOverview(container);
  else if (section === 'activity') renderStatsActivity(container);
  else if (section === 'insights') renderStatsInsights(container);
}

function renderStatsOverview(container) {
  const isMobile = window.innerWidth < 480;
  const heatmapWeeks = isMobile ? 8 : 12;
  const weeklyData = getWeeklyStats(8);
  const streak = computeStreak();
  const longest = computeLongestStreak();

  container.innerHTML = `
    <div class="chart-card">
      <div class="chart-title">Weekly Completion (last 8 weeks)</div>
      <div class="chart-svg-wrap">${renderBarChartSVG(weeklyData)}</div>
    </div>

    <div class="streak-card" style="margin-bottom:16px;">
      <div class="streak-big-num">${streak >= 7 ? '🔥' : ''} ${streak}</div>
      <div class="streak-card-info">
        <div class="streak-card-label">day streak</div>
        <div class="streak-card-sub">Longest: ${longest} days</div>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-title">Activity — last ${heatmapWeeks} weeks</div>
      <div class="heatmap-wrap">${renderHeatmapSVG(heatmapWeeks)}</div>
    </div>
  `;
}

function renderBarChartSVG(weeklyData) {
  const W = 300, H = 110;
  const barCount = weeklyData.length;
  const barW = Math.floor(W / barCount) - 6;
  const maxBarH = 72;
  const labelY = H - 4;
  const pctY = 10;

  let bars = '', labels = '', pcts = '';

  weeklyData.forEach((week, i) => {
    const barH = Math.max(week.pct > 0 ? 4 : 0, (week.pct / 100) * maxBarH);
    const x = i * (W / barCount) + 3;
    const y = H - barH - 20;
    const isCurrent = i === barCount - 1;
    const fill = isCurrent ? 'var(--accent)' : 'var(--accent-dim)';
    const opacity = isCurrent ? '1' : '0.55';

    bars   += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="${fill}" opacity="${opacity}"/>`;
    labels += `<text x="${x + barW/2}" y="${labelY}" text-anchor="middle" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${week.label}</text>`;

    if (week.pct > 0) {
      pcts += `<text x="${x + barW/2}" y="${Math.max(y - 3, pctY)}" text-anchor="middle" font-size="9" fill="${isCurrent ? 'var(--accent)' : 'var(--text-muted)'}" font-family="'DM Mono',monospace">${week.pct}%</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${bars}${pcts}${labels}
  </svg>`;
}

function renderHeatmapSVG(numWeeks) {
  const cell = 12, gap = 2, step = cell + gap;
  const todayDate = today();
  const monday = getMondayOfWeek(todayDate);
  const startMonday = addDays(monday, -(numWeeks - 1) * 7);

  const W = numWeeks * step;
  const H = 7 * step + 18; // 18px for month labels

  let cells = '';
  let monthLabels = '';
  let lastMonth = -1;

  for (let w = 0; w < numWeeks; w++) {
    const weekMonday = addDays(startMonday, w * 7);
    const monthNum = weekMonday.getMonth();

    if (monthNum !== lastMonth) {
      lastMonth = monthNum;
      const x = w * step;
      monthLabels += `<text x="${x}" y="${H - 2}" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${MONTH_NAMES[monthNum]}</text>`;
    }

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekMonday, d);
      const isFuture = date > todayDate;
      const dateStr = formatDate(date);

      let fill = 'var(--bg-elevated)';

      if (!isFuture) {
        const habits = getHabitsForDate(date);
        if (habits.length > 0) {
          const logs = getLogsForDate(dateStr);
          const done = habits.filter(h => logs[h.id]).length;
          const pct = done / habits.length;

          if (pct === 0)      fill = 'var(--bg-elevated)';
          else if (pct < 0.34) fill = '#1a3d30';
          else if (pct < 0.67) fill = '#34d399';
          else if (pct < 1)    fill = '#6ee7b7';
          else                 fill = '#a7f3d0';
        }
      }

      const x = w * step;
      const y = d * step;

      cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}" data-date="${dateStr}">
        <title>${dateStr}: ${(() => {
          if (isFuture) return 'Future';
          const habits = getHabitsForDate(date);
          if (!habits.length) return 'No habits';
          const logs = getLogsForDate(dateStr);
          const done = habits.filter(h => logs[h.id]).length;
          return `${done}/${habits.length} completed`;
        })()}</title>
      </rect>`;
    }
  }

  // Day-of-week labels on left
  const dayLetters = ['M','T','W','T','F','S','S'];
  let dayLabels = '';
  for (let d = 0; d < 7; d++) {
    if (d % 2 === 0) {
      dayLabels += `<text x="-14" y="${d * step + cell - 1}" font-size="9" fill="var(--text-muted)" font-family="'DM Mono',monospace">${dayLetters[d]}</text>`;
    }
  }

  return `<svg width="${W + 16}" height="${H}" viewBox="-16 0 ${W + 16} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${dayLabels}${cells}${monthLabels}
  </svg>`;
}

function renderStatsActivity(container) {
  const allHabits = [
    ...BUILT_IN_HABITS.filter(h => !state.hiddenBuiltins.has(h.id)),
    ...state.customHabits.filter(h => h.active).map(c => ({
      id: c.id, name: c.name, days: c.days, category: 'custom', color: c.color,
    })),
  ];

  const rows = allHabits.map(habit => {
    let scheduled = 0, completed = 0;
    for (let i = 0; i < 30; i++) {
      const d = addDays(today(), -i);
      if (!habit.days.includes(d.getDay())) continue;
      scheduled++;
      if (isCompleted(formatDate(d), habit.id)) completed++;
    }
    const rate = scheduled > 0 ? Math.round((completed / scheduled) * 100) : null;
    const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';

    return `
      <div class="activity-habit-row" data-habit="${habit.id}">
        <div class="cat-dot" style="background:${color}"></div>
        <div class="activity-habit-name">${habit.name}</div>
        <div class="activity-habit-rate">${rate !== null ? rate + '%' : '—'}</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="activity-habit-list">${rows || '<p style="color:var(--text-muted);padding:16px;">No habits yet.</p>'}</div>`;

  container.querySelectorAll('.activity-habit-row').forEach(row => {
    row.addEventListener('click', () => {
      const habitId = row.dataset.habit;
      const habit = allHabits.find(h => h.id === habitId);
      if (habit) openActivityDetail(habit);
    });
  });
}

function openActivityDetail(habit) {
  const color = habit.color || CATEGORY_COLORS[habit.category] || 'var(--accent)';

  // Compute stats
  let sched30 = 0, done30 = 0;
  let missedMonth = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(today(), -i);
    if (!habit.days.includes(d.getDay())) continue;
    sched30++;
    if (isCompleted(formatDate(d), habit.id)) done30++;
    else missedMonth++;
  }
  const rate30 = sched30 > 0 ? Math.round((done30 / sched30) * 100) : null;
  const streak = computeHabitStreak(habit.id);
  const weeklyData = getHabitWeeklyData(habit, 8);

  const html = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      <div class="cat-dot" style="background:${color};width:12px;height:12px;"></div>
      <div style="font-size:16px;font-weight:600;">${habit.name}</div>
    </div>
    <div class="activity-detail">
      <div class="activity-detail-stat">
        <span class="activity-detail-label">Last 4 weeks</span>
        <span class="activity-detail-value">${rate30 !== null ? rate30 + '%' : '—'}</span>
      </div>
      <div class="activity-detail-stat">
        <span class="activity-detail-label">Current streak</span>
        <span class="activity-detail-value">${streak} day${streak !== 1 ? 's' : ''}</span>
      </div>
      <div class="activity-detail-stat">
        <span class="activity-detail-label">Missed this month</span>
        <span class="activity-detail-value">${missedMonth} time${missedMonth !== 1 ? 's' : ''}</span>
      </div>
    </div>
    <div style="margin-top:16px;">
      <div class="chart-title">8-week completion</div>
      <div class="chart-svg-wrap">${renderBarChartSVG(weeklyData)}</div>
    </div>
  `;

  openModal(html, habit.name);
}

function getHabitWeeklyData(habit, numWeeks) {
  const todayDate = today();
  const monday = getMondayOfWeek(todayDate);
  const result = [];

  for (let w = numWeeks - 1; w >= 0; w--) {
    const weekStart = addDays(monday, -w * 7);
    let scheduled = 0, completed = 0;

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (date > todayDate) break;
      if (!habit.days.includes(date.getDay())) continue;
      scheduled++;
      if (isCompleted(formatDate(date), habit.id)) completed++;
    }

    const pct = scheduled > 0 ? Math.round((completed / scheduled) * 100) : 0;
    result.push({ label: `W${numWeeks - w}`, pct, completed, scheduled });
  }

  return result;
}

function renderStatsInsights(container) {
  const insights = generateInsights();
  if (insights.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:16px;text-align:center;">Log some habits to see insights.</p>`;
    return;
  }
  const html = insights.map(text => `
    <div class="insight-item">
      <div class="insight-bullet"></div>
      <div>${text}</div>
    </div>
  `).join('');
  container.innerHTML = `<div class="insights-list">${html}</div>`;
}

function generateInsights() {
  const insights = [];
  const allHabits = [
    ...BUILT_IN_HABITS.filter(h => !state.hiddenBuiltins.has(h.id)),
    ...state.customHabits.filter(h => h.active).map(c => ({
      id: c.id, name: c.name, days: c.days, category: 'custom',
    })),
  ];

  // Per-habit completion rates
  const habitStats = allHabits.map(habit => {
    let sched = 0, done = 0;
    for (let i = 0; i < 30; i++) {
      const d = addDays(today(), -i);
      if (!habit.days.includes(d.getDay())) continue;
      sched++;
      if (isCompleted(formatDate(d), habit.id)) done++;
    }
    const rate = sched > 0 ? Math.round((done / sched) * 100) : null;
    return { habit, sched, done, rate };
  }).filter(s => s.rate !== null);

  // Most interesting (farthest from 50%)
  const sorted = [...habitStats].sort((a, b) => Math.abs(b.rate - 50) - Math.abs(a.rate - 50));

  for (const { habit, rate } of sorted.slice(0, 2)) {
    insights.push(`You complete ${habit.name} on ${rate}% of scheduled days`);
  }

  // Weakest day of week
  const dayStats = [0,1,2,3,4,5,6].map(dow => {
    let total = 0, done = 0;
    for (let i = 0; i < 30; i++) {
      const d = addDays(today(), -i);
      if (d.getDay() !== dow) continue;
      const habits = getHabitsForDate(d);
      if (!habits.length) continue;
      total += habits.length;
      const logs = getLogsForDate(formatDate(d));
      done += habits.filter(h => logs[h.id]).length;
    }
    const pct = total > 0 ? Math.round((done / total) * 100) : null;
    return { dow, pct, total };
  }).filter(d => d.total > 0 && d.pct !== null);

  if (dayStats.length > 0) {
    const weakest = dayStats.reduce((a, b) => a.pct < b.pct ? a : b);
    insights.push(`Your weakest day is ${DAY_FULL[weakest.dow]} (avg ${weakest.pct}%)`);
  }

  // Perfect days this week
  const mondayOfThisWeek = getMondayOfWeek(today());
  let perfectDays = 0;
  for (let d = 0; d < 7; d++) {
    const date = addDays(mondayOfThisWeek, d);
    if (date > today()) break;
    const habits = getHabitsForDate(date);
    if (!habits.length) continue;
    const logs = getLogsForDate(formatDate(date));
    if (habits.every(h => logs[h.id])) perfectDays++;
  }
  if (perfectDays > 0) {
    insights.push(`You've hit 100% on ${perfectDays} day${perfectDays !== 1 ? 's' : ''} this week`);
  }

  // Per-habit streaks for notable ones
  for (const { habit } of sorted.slice(0, 2)) {
    const s = computeHabitStreak(habit.id);
    if (s >= 2) {
      insights.push(`${habit.name}: ${s} sessions in a row ${s >= 4 ? '🔥' : ''}`);
    }
  }

  return insights.slice(0, 6);
}

// ============================================================
// SPLIT TAB
// ============================================================

// ============================================================
// MOBILITY DATA
// ============================================================

const MOBILITY_WARMUP = {
  title: 'Pre-workout Dynamic Warm-up',
  duration: '5 min — do before every gym session',
  exercises: [
    { name: 'Leg swing forward/back', detail: '10 reps/side' },
    { name: 'Leg swing lateral', detail: '10 reps/side' },
    { name: 'Hip circle', detail: '10 reps/side' },
    { name: "World's greatest stretch", detail: '5 reps/side' },
    { name: 'Knee-to-wall ankle mob', detail: '10 reps/side', priority: true },
    { name: 'Bodyweight squat hold', detail: '10 slow reps' },
    { name: 'Cat-cow', detail: '8 reps' },
  ],
};

const MOBILITY_DATA = [
  {
    day: 1, name: 'Monday', label: 'Push A — post-workout · 6 min',
    exercises: [
      { name: 'Thread-the-needle', detail: '45 sec/side' },
      { name: 'Doorway chest stretch / band pull-apart', detail: '30 sec' },
      { name: 'Shoulder CARs', detail: '5 slow circles/side' },
      { name: 'Standing calf stretch (straight leg)', detail: '45 sec/side' },
      { name: 'Standing calf stretch (bent knee / soleus)', detail: '45 sec/side' },
    ],
  },
  {
    day: 2, name: 'Tuesday', label: 'Legs A — post-workout · 8 min',
    exercises: [
      { name: 'Elevated heel deep squat hold', detail: '60 sec' },
      { name: 'Couch stretch', detail: '60 sec/side' },
      { name: '90/90 hip stretch', detail: '45 sec/side' },
      { name: 'Standing calf stretch (straight leg)', detail: '45 sec/side' },
      { name: 'Standing calf stretch (bent knee)', detail: '45 sec/side' },
    ],
  },
  {
    day: 3, name: 'Wednesday', label: 'Pull A — post-workout · 6 min',
    exercises: [
      { name: 'Thread-the-needle', detail: '45 sec/side' },
      { name: 'Shoulder CARs', detail: '5 slow circles/side' },
      { name: 'Hip flexor lunge stretch', detail: '45 sec/side' },
      { name: 'Standing calf stretch', detail: '45 sec/side' },
    ],
  },
  {
    day: 4, name: 'Thursday', label: 'Push B — post-workout · 6 min',
    note: 'Same as Monday',
    exercises: [
      { name: 'Thread-the-needle', detail: '45 sec/side' },
      { name: 'Doorway chest stretch / band pull-apart', detail: '30 sec' },
      { name: 'Shoulder CARs', detail: '5 slow circles/side' },
      { name: 'Standing calf stretch (straight leg)', detail: '45 sec/side' },
      { name: 'Standing calf stretch (bent knee)', detail: '45 sec/side' },
    ],
  },
  {
    day: 5, name: 'Friday', label: 'Pull B / Legs posterior — post-workout · 8 min',
    note: 'Same as Tuesday (heavy leg work)',
    exercises: [
      { name: 'Elevated heel deep squat hold', detail: '60 sec' },
      { name: 'Couch stretch', detail: '60 sec/side' },
      { name: '90/90 hip stretch', detail: '45 sec/side' },
      { name: 'Standing calf stretch (straight leg)', detail: '45 sec/side' },
      { name: 'Standing calf stretch (bent knee)', detail: '45 sec/side' },
    ],
  },
  {
    day: 6, name: 'Saturday', label: 'Cardio day — after Zone 2 · 8 min',
    note: 'Full body — more time available, no heavy lifting today',
    exercises: [
      { name: 'Couch stretch', detail: '60 sec/side' },
      { name: '90/90 hip stretch', detail: '45 sec/side' },
      { name: 'Elevated heel deep squat hold', detail: '60 sec' },
      { name: 'Thread-the-needle', detail: '45 sec/side' },
      { name: 'Shoulder CARs', detail: '5 circles/side' },
      { name: 'Standing calf stretch (straight + bent knee)', detail: '45 sec/side each' },
    ],
  },
  {
    day: 0, name: 'Sunday', label: 'Dedicated session · 15–20 min',
    note: 'This is where real ROM change happens. Use PAILs/RAILs.',
    pails: true,
    pailsMethod: 'Get into the stretch → 10 sec push INTO the stretch (isometric) → 10 sec pull OUT of the stretch (active) → move deeper → repeat.',
    exercises: [
      { name: 'Couch stretch + PAILs/RAILs', detail: '3 rounds/side', pails: true },
      { name: '90/90 + PAILs/RAILs', detail: '3 rounds/side', pails: true },
      { name: 'Deep squat progressive hold (no heel elevation)', detail: '3 × 45 sec, go deeper each round' },
      { name: 'Thread-the-needle', detail: '60 sec/side (passive, no PAILs)' },
      { name: 'Calf stretch (both variations)', detail: '60 sec/side' },
    ],
  },
];

const MOBILITY_NOTES = [
  { priority: true,  text: 'Knee-to-wall is your #1 priority every day. Takes 2 min, fixes your squat.' },
  { priority: false, text: 'On leg days: put a small plate (~1–2 cm) under your heels on Smith squat while you build ankle mobility.' },
  { priority: false, text: 'Calf stretch: straight leg = gastrocnemius, bent knee = soleus. Do both — both are tight if your squat falls back.' },
  { priority: true,  text: "PAILs/RAILs on Sunday is where real ROM change happens. Don't skip it." },
];

const SPLIT_DATA = [
  {
    day: 1, name: 'Monday', label: 'Push A + Skill',
    activities: [
      { cat: 'gym',      text: 'Push Session', sub: 'Chest · Back · Deltas · Calves' },
      { cat: 'mobility', text: 'Mobility', sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand', sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Monday — Push (Chest + Back + Deltas + Calves)',
      groups: [
        { name: 'Chest',      exercises: ['Pec machine 3×', 'Bench press 2×'] },
        { name: 'Back',       exercises: ['Lat pulldown 3×', 'Seated cable row 3×'] },
        { name: 'Calves',     exercises: ['Calf raise 2×'] },
        { name: 'Lateral',    exercises: ['Cable lateral raise 3×'] },
        { name: 'Rear delts', exercises: ['Rear-delt isolation 3×'] },
        { name: 'Triceps',    exercises: ['3×'] },
      ],
    },
  },
  {
    day: 2, name: 'Tuesday', label: 'Legs A + Skill',
    activities: [
      { cat: 'gym',      text: 'Legs Session', sub: 'Quads bias + Glute bias' },
      { cat: 'mobility', text: 'Mobility', sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand', sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Tuesday — Legs A (Quads bias + Glutes)',
      groups: [
        { name: 'Quads',      exercises: ['Smith squat 3×', 'Leg press (quad) 2×', 'Leg ext 2×'] },
        { name: 'Hamstrings', exercises: ['Lying ham curl 3×', 'RDL 1×'] },
        { name: 'Glutes',     exercises: ['Bulgarian split squat 2×', 'Leg press (glute) 1×'] },
        { name: 'Calves',     exercises: ['Standing calf raise 2×'] },
        { name: 'Lateral',    exercises: ['Cable lateral raise 2×'] },
        { name: 'Triceps',    exercises: ['Pushdown 2×'] },
      ],
    },
  },
  {
    day: 3, name: 'Wednesday', label: 'Pull A',
    activities: [
      { cat: 'gym',      text: 'Pull Session', sub: 'Back + Biceps' },
      { cat: 'mobility', text: 'Mobility', sub: '10 min' },
      { cat: 'skill',    text: 'OAH skipped', sub: 'CNS rest from balance' },
    ],
    gym: {
      title: 'Wednesday — Pull (Back + Biceps)',
      groups: [
        { name: 'Back',    exercises: ['Barbell row 3×', 'Lat pulldown 3×', 'Seated cable row 2×'] },
        { name: 'Biceps',  exercises: ['Bayesian cable curl 3×', 'Preacher curl 3×'] },
      ],
    },
  },
  {
    day: 4, name: 'Thursday', label: 'Push B + Skill',
    activities: [
      { cat: 'gym',      text: 'Push Session', sub: 'Chest + Triceps + Deltas + Calves' },
      { cat: 'mobility', text: 'Mobility', sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand', sub: '15–20 min, before gym' },
    ],
    gym: {
      title: 'Thursday — Push B (Chest + Triceps + Deltas + Calves)',
      groups: [
        { name: 'Chest',      exercises: ['Incline bench (smith) 3×', 'Flat bench 2×', 'Pec machine 2×'] },
        { name: 'Calves',     exercises: ['Calf raise 2×'] },
        { name: 'Triceps',    exercises: ['Overhead triceps 2×', 'Pushdown 1×'] },
        { name: 'Lateral',    exercises: ['Cable lateral raise 3×'] },
        { name: 'Rear delts', exercises: ['Rear-delt isolation 3×'] },
      ],
    },
  },
  {
    day: 5, name: 'Friday', label: 'Pull B + Skill',
    activities: [
      { cat: 'gym',      text: 'Pull Session', sub: 'Lower posterior bias + Biceps + Deltas' },
      { cat: 'mobility', text: 'Mobility', sub: '10 min' },
      { cat: 'skill',    text: 'OAH / Handstand', sub: '15–20 min, lighter' },
    ],
    gym: {
      title: 'Friday — Pull B (Posterior + Biceps + Deltas)',
      groups: [
        { name: 'Hamstrings', exercises: ['Barbell RDL 4×', 'Lying ham curl 2×'] },
        { name: 'Quads',      exercises: ['Smith squat 2×', 'Leg extension 3×'] },
        { name: 'Glutes',     exercises: ['Bulgarian split squat 2×', 'Leg press (glutes) 1×'] },
        { name: 'Calves',     exercises: ['Calf raise 2×'] },
        { name: 'Lateral',    exercises: ['Cable lateral raise 2×'] },
        { name: 'Biceps',     exercises: ['Preacher curl 2×'] },
      ],
    },
  },
  {
    day: 6, name: 'Saturday', label: 'Cardio + Skill',
    activities: [
      { cat: 'cardio',   text: 'HIIT: Norwegian 4×4', sub: '~38 min' },
      { cat: 'cardio',   text: 'Zone 2 Cardio', sub: '60 min — bike/row/walk' },
      { cat: 'mobility', text: 'Mobility Flow', sub: '15–20 min dedicated session' },
      { cat: 'skill',    text: 'OAH / Handstand', sub: '20–30 min skill session' },
    ],
    gym: null,
  },
  {
    day: 0, name: 'Sunday', label: 'Active Recovery',
    activities: [
      { cat: 'cardio',   text: 'Zone 2 Cardio', sub: '60 min — easy' },
      { cat: 'mobility', text: 'Mobility', sub: 'light flow + foam rolling' },
    ],
    gym: null,
  },
];

const VOLUME_SUMMARY = [
  { name: 'Chest',      sets: 12, min: 10, max: 20 },
  { name: 'Back',       sets: 14, min: 10, max: 20 },
  { name: 'Quads',      sets: 12, min: 10, max: 20 },
  { name: 'Hamstrings', sets: 10, min: 10, max: 20 },
  { name: 'Glutes',     sets: 6,  min: 6,  max: 10 },
  { name: 'Calves',     sets: 8,  min: 6,  max: 12 },
  { name: 'Biceps',     sets: 8,  min: 6,  max: 14 },
  { name: 'Triceps',    sets: 8,  min: 6,  max: 14 },
  { name: 'Lat delts',  sets: 10, min: 8,  max: 16 },
  { name: 'Rear delts', sets: 6,  min: 6,  max: 12 },
  { name: 'Front',      sets: 0,  min: 0,  max: 6 },
];

function renderSplit() {
  const panel = document.getElementById('tab-split');
  const todayDow = today().getDay();

  panel.innerHTML = `
    <div class="pill-nav">
      <button class="pill-btn ${state.splitView === 'fullweek' ? 'active' : ''}" data-view="fullweek">Full Week</button>
      <button class="pill-btn ${state.splitView === 'gymonly' ? 'active' : ''}" data-view="gymonly">Gym Only</button>
      <button class="pill-btn ${state.splitView === 'mobility' ? 'active' : ''}" data-view="mobility">Mobility</button>
    </div>
    <div id="split-content"></div>
  `;

  panel.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.splitView = btn.dataset.view;
      panel.querySelectorAll('.pill-btn').forEach(b => b.classList.toggle('active', b.dataset.view === state.splitView));
      renderSplitContent(state.splitView, todayDow);
    });
  });

  renderSplitContent(state.splitView, todayDow);
}

function renderSplitContent(view, todayDow) {
  const container = document.getElementById('split-content');
  if (!container) return;

  if (view === 'fullweek') {
    let html = '';
    for (const day of SPLIT_DATA) {
      const isToday = day.day === todayDow;
      const isMobile = window.innerWidth < 768;
      const openClass = (isToday || !isMobile) ? ' open' : '';

      html += `
        <div class="split-day-card${isToday ? ' today-card' : ''}${openClass}" data-day="${day.day}">
          <div class="split-day-header">
            <div>
              <div class="split-day-title">${day.name}</div>
              <div class="split-day-subtitle">${day.label}</div>
            </div>
            <svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div class="split-day-body">
            <div class="split-activity-list">
              ${day.activities.map(a => `
                <div class="split-activity-item">
                  <div class="cat-dot" style="background:${CATEGORY_COLORS[a.cat]}"></div>
                  <div>${a.text}${a.sub ? ` <span>${a.sub}</span>` : ''}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;

    container.querySelectorAll('.split-day-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.split-day-card').classList.toggle('open');
      });
    });

  } else {
    // Gym only
    const gymDays = SPLIT_DATA.filter(d => d.gym);
    let html = '';

    for (const day of gymDays) {
      const isToday = day.day === todayDow;
      const isMobile = window.innerWidth < 768;
      const openClass = (isToday || !isMobile) ? ' open' : '';

      html += `
        <div class="split-day-card${isToday ? ' today-card' : ''}${openClass}" data-day="${day.day}">
          <div class="split-day-header">
            <div>
              <div class="split-day-title">${day.gym.title}</div>
            </div>
            <svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          <div class="split-day-body">
            <div class="gym-exercises">
              ${day.gym.groups.map(g => `
                <div class="gym-muscle-group">
                  <div class="gym-muscle-label">${g.name}</div>
                  <div class="gym-exercise-list">
                    ${g.exercises.map(e => `<div class="gym-exercise-chip">${e}</div>`).join('')}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    }

    // Volume summary
    const volHtml = VOLUME_SUMMARY.map(v => {
      const cls = v.sets >= v.min ? 'good' : (v.sets >= v.min * 0.7 ? 'ok' : '');
      return `
        <div class="volume-chip ${cls}">
          <div class="volume-label">${v.name}</div>
          <div class="volume-num">${v.sets}</div>
        </div>
      `;
    }).join('');

    html += `
      <div class="collapsible-header" id="volume-toggle">
        Weekly Volume
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="collapsible-body" id="volume-body">
        <div class="volume-grid">${volHtml}</div>
      </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('.split-day-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.split-day-card').classList.toggle('open');
      });
    });

    var volToggle = document.getElementById('volume-toggle');
    if (volToggle) volToggle.addEventListener('click', function() {
      document.getElementById('volume-body').classList.toggle('open');
    });

  } else if (view === 'mobility') {
    renderMobilitySplit(container, todayDow);
  }
}

function renderMobilitySplit(container, todayDow) {
  const isMobile = window.innerWidth < 768;

  // Warm-up card (always open)
  let html = `
    <div class="split-day-card open" style="margin-bottom:10px;">
      <div class="split-day-header">
        <div>
          <div class="split-day-title">Every Day — Pre-workout Warm-up</div>
          <div class="split-day-subtitle">${MOBILITY_WARMUP.duration}</div>
        </div>
        <svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="split-day-body">
        <div class="mobility-exercise-list">
          ${MOBILITY_WARMUP.exercises.map(ex => `
            <div class="mobility-exercise-row ${ex.priority ? 'priority' : ''}">
              ${ex.priority ? '<div class="mobility-priority-dot"></div>' : '<div class="mobility-dot"></div>'}
              <div class="mobility-exercise-name">${ex.name}${ex.priority ? ' ★' : ''}</div>
              <div class="mobility-exercise-detail">${ex.detail}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  // Per-day cards
  for (const day of MOBILITY_DATA) {
    const isToday = day.day === todayDow;
    const openClass = (isToday || !isMobile) ? ' open' : '';

    const pailsBadge = day.pails
      ? `<span class="mobility-pails-badge">PAILs/RAILs</span>`
      : '';

    const pailsExplainer = day.pails && day.pailsMethod
      ? `<div class="mobility-pails-explainer">${day.pailsMethod}</div>`
      : '';

    const noteHtml = day.note
      ? `<div class="mobility-day-note">${day.note}</div>`
      : '';

    html += `
      <div class="split-day-card${isToday ? ' today-card' : ''}${openClass}" data-day="${day.day}">
        <div class="split-day-header">
          <div>
            <div class="split-day-title" style="display:flex;align-items:center;gap:8px;">
              ${day.name} ${pailsBadge}
            </div>
            <div class="split-day-subtitle">${day.label}</div>
          </div>
          <svg class="split-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
        <div class="split-day-body">
          ${noteHtml}
          ${pailsExplainer}
          <div class="mobility-exercise-list">
            ${day.exercises.map(ex => `
              <div class="mobility-exercise-row ${ex.pails ? 'has-pails' : ''}">
                <div class="mobility-dot"></div>
                <div class="mobility-exercise-name">${ex.name}</div>
                <div class="mobility-exercise-detail">${ex.detail}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // Notes section
  const notesHtml = MOBILITY_NOTES.map(n => `
    <div class="mobility-note-item ${n.priority ? 'priority' : ''}">
      <div class="mobility-note-dot"></div>
      <div>${n.text}</div>
    </div>
  `).join('');

  html += `
    <div class="collapsible-header" id="mobility-notes-toggle">
      Notes & Cues
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
    <div class="collapsible-body" id="mobility-notes-body">
      <div class="mobility-notes-list">${notesHtml}</div>
    </div>
  `;

  container.innerHTML = html;

  container.querySelectorAll('.split-day-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.split-day-card').classList.toggle('open');
    });
  });

  var mobNotesToggle = document.getElementById('mobility-notes-toggle');
  if (mobNotesToggle) mobNotesToggle.addEventListener('click', function() {
    document.getElementById('mobility-notes-body').classList.toggle('open');
  });
}

// ============================================================
// SETTINGS TAB
// ============================================================

function renderSettings() {
  const panel = document.getElementById('tab-settings');

  const customHabitsHtml = state.customHabits.length === 0
    ? '<p style="color:var(--text-muted);font-size:13px;padding:8px 0;">No custom habits yet.</p>'
    : `<div class="custom-habit-list">
        ${state.customHabits.map(h => renderCustomHabitRow(h)).join('')}
      </div>`;

  const builtinHabitsHtml = BUILT_IN_HABITS.map(h => `
    <div class="builtin-habit-row">
      <div class="cat-dot" style="background:${CATEGORY_COLORS[h.category]}"></div>
      <div class="builtin-habit-name">${h.name}</div>
      <span class="chip chip-builtin">Built-in</span>
      <label class="toggle-switch" title="Show/hide this habit">
        <input type="checkbox" ${!state.hiddenBuiltins.has(h.id) ? 'checked' : ''} data-builtin="${h.id}">
        <div class="toggle-track"></div>
        <div class="toggle-thumb"></div>
      </label>
    </div>
  `).join('');

  panel.innerHTML = `
    <div class="section-title">Add Custom Habit</div>
    <div class="card">
      <form id="add-habit-form" class="settings-form">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="new-habit-name" type="text" placeholder="e.g. Morning Reading" maxlength="40" required>
        </div>
        <div class="form-group">
          <label class="form-label">Days</label>
          <div class="day-selector" id="day-selector">
            ${['M','T','W','T','F','S','S'].map((lbl, i) => {
              const dow = i === 6 ? 0 : i + 1; // Mon=1, Sun=0
              return `<button type="button" class="day-toggle-btn" data-dow="${dow}">${lbl}</button>`;
            }).join('')}
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <div class="color-swatches" id="color-swatches">
            ${PRESET_COLORS.map((c, i) => `
              <div class="color-swatch ${i === 0 ? 'selected' : ''}"
                   style="background:${c}" data-color="${c}"></div>
            `).join('')}
          </div>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Add Habit</button>
      </form>
    </div>

    <div class="section-title">Custom Habits</div>
    <div id="custom-habits-section">${customHabitsHtml}</div>

    <div class="section-title">Built-in Habits</div>
    <div class="card">${builtinHabitsHtml}</div>

    <div class="section-title">Data</div>
    <div class="card data-actions">
      <button class="btn btn-ghost" id="export-btn" style="width:100%;justify-content:flex-start;gap:10px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Export data as JSON
      </button>
      <button class="btn btn-danger" id="clear-btn" style="width:100%;justify-content:flex-start;gap:10px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6M14 11v6"/>
        </svg>
        Clear all data
      </button>
    </div>

    <div class="section-title">About</div>
    <div class="card">
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--text-muted)">Version</span>
          <span style="font-family:var(--font-mono)">1.0.0</span>
        </div>
        <div class="connection-status">
          <div class="status-dot ${state.connectionOk ? 'connected' : 'error'}" id="conn-dot"></div>
          <span id="conn-label">${state.connectionOk ? 'Supabase connected' : 'Connection error'}</span>
        </div>
      </div>
    </div>
  `;

  // Day selector state
  const selectedDays = new Set();
  panel.querySelectorAll('.day-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dow = parseInt(btn.dataset.dow);
      if (selectedDays.has(dow)) {
        selectedDays.delete(dow);
        btn.classList.remove('active');
      } else {
        selectedDays.add(dow);
        btn.classList.add('active');
      }
    });
  });

  // Color swatch selection
  let selectedColor = PRESET_COLORS[0];
  panel.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
      selectedColor = swatch.dataset.color;
    });
  });

  // Add habit form
  panel.querySelector('#add-habit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-habit-name').value.trim();
    if (!name) return;
    if (selectedDays.size === 0) {
      showToast('Select at least one day', 'warning');
      return;
    }
    const { data, error } = await dbCreateCustomHabit({
      name,
      days: [...selectedDays],
      color: selectedColor,
      sort_order: state.customHabits.length,
    });
    if (error) {
      showToast('Failed to save habit', 'error');
      return;
    }
    state.customHabits.push(data);
    showToast('Habit added', 'success');
    renderSettings();
    switchTab('today');
  });

  // Built-in visibility toggles
  panel.querySelectorAll('[data-builtin]').forEach(input => {
    input.addEventListener('change', () => {
      const habitId = input.dataset.builtin;
      if (input.checked) {
        state.hiddenBuiltins.delete(habitId);
      } else {
        state.hiddenBuiltins.add(habitId);
      }
      saveHiddenBuiltins();
      renderTodayHabits(today());
    });
  });

  // Custom habit toggles and deletes
  panel.querySelectorAll('[data-toggle-custom]').forEach(input => {
    input.addEventListener('change', async () => {
      const id = input.dataset.toggleCustom;
      const habit = state.customHabits.find(h => h.id === id);
      if (!habit) return;
      habit.active = input.checked;
      await dbUpdateCustomHabit(id, { active: habit.active });
    });
  });

  panel.querySelectorAll('[data-delete-custom]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteCustom;
      const { error } = await dbDeleteCustomHabit(id);
      if (error) { showToast('Delete failed', 'error'); return; }
      state.customHabits = state.customHabits.filter(h => h.id !== id);
      showToast('Habit deleted', 'default');
      renderSettings();
    });
  });

  // Export
  panel.querySelector('#export-btn').addEventListener('click', async () => {
    const { data, error } = await dbExportAll();
    if (error) { showToast('Export failed', 'error'); return; }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dontdie-export-${formatDate(today())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Clear all
  panel.querySelector('#clear-btn').addEventListener('click', () => {
    openModal(`
      <p style="color:var(--text-secondary);font-size:14px;margin-bottom:20px;">
        This will permanently delete all habit log data. This cannot be undone.
      </p>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="cancel-clear" style="flex:1;">Cancel</button>
        <button class="btn btn-danger" id="confirm-clear" style="flex:1;">Delete All</button>
      </div>
    `, 'Clear All Data?');

    document.getElementById('cancel-clear').addEventListener('click', closeModal);
    document.getElementById('confirm-clear').addEventListener('click', async () => {
      closeModal();
      const { error } = await dbDeleteAllLogs();
      if (error) { showToast('Failed to clear data', 'error'); return; }
      state.logsByDate = {};
      showToast('All data cleared', 'default');
      renderToday(today());
    });
  });
}

function renderCustomHabitRow(h) {
  const dayDots = [1,2,3,4,5,6,0].map(dow => `
    <div class="custom-habit-day-dot ${h.days.includes(dow) ? 'active' : ''}"></div>
  `).join('');

  return `
    <div class="custom-habit-row">
      <div class="custom-habit-color" style="background:${h.color || 'var(--accent)'}"></div>
      <div class="custom-habit-name">${h.name}</div>
      <div class="custom-habit-days">${dayDots}</div>
      <label class="toggle-switch">
        <input type="checkbox" ${h.active ? 'checked' : ''} data-toggle-custom="${h.id}">
        <div class="toggle-track"></div>
        <div class="toggle-thumb"></div>
      </label>
      <button class="custom-habit-delete" data-delete-custom="${h.id}" aria-label="Delete">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        </svg>
      </button>
    </div>
  `;
}

function saveHiddenBuiltins() {
  localStorage.setItem('hidden_builtins', JSON.stringify([...state.hiddenBuiltins]));
}

function loadHiddenBuiltins() {
  try {
    const stored = JSON.parse(localStorage.getItem('hidden_builtins') || '[]');
    state.hiddenBuiltins = new Set(stored);
  } catch {
    state.hiddenBuiltins = new Set();
  }
}

// ============================================================
// PIN AUTHENTICATION
// ============================================================

let pinBuffer = '';

async function initPin() {
  const screen = document.getElementById('pin-screen');
  screen.classList.remove('hidden');

  document.querySelectorAll('.pin-key[data-key]').forEach(btn => {
    btn.addEventListener('click', () => handlePinKey(btn.dataset.key));
  });

  document.getElementById('pin-back').addEventListener('click', () => {
    if (pinBuffer.length > 0) {
      pinBuffer = pinBuffer.slice(0, -1);
      updatePinDots();
    }
  });

  // Keyboard support
  document.addEventListener('keydown', (e) => {
    if (screen.classList.contains('hidden')) return;
    if (e.key >= '0' && e.key <= '9') handlePinKey(e.key);
    else if (e.key === 'Backspace') {
      pinBuffer = pinBuffer.slice(0, -1);
      updatePinDots();
    }
  });
}

function updatePinDots() {
  for (var i = 0; i < 4; i++) {
    var dot = document.getElementById('dot-' + i);
    if (dot) dot.classList.toggle('filled', i < pinBuffer.length);
  }
}

async function handlePinKey(digit) {
  if (pinBuffer.length >= 4) return;
  pinBuffer += digit;
  updatePinDots();

  if (pinBuffer.length === 4) {
    const hash = await hashPin(pinBuffer);
    if (hash === CONFIG.PIN_HASH) {
      sessionStorage.setItem('auth', '1');
      document.getElementById('pin-screen').classList.add('hidden');
      startApp();
    } else {
      // Wrong PIN — shake and clear
      const keypad = document.getElementById('pin-keypad');
      keypad.classList.add('shake');
      keypad.addEventListener('animationend', () => keypad.classList.remove('shake'), { once: true });
      pinBuffer = '';
      setTimeout(updatePinDots, 50);
    }
  }
}

// ============================================================
// CONFIG VALIDATION
// ============================================================

function isConfigValid() {
  return (
    CONFIG.SUPABASE_URL &&
    CONFIG.SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL' &&
    CONFIG.SUPABASE_ANON_KEY &&
    CONFIG.SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY'
  );
}

// ============================================================
// APP INITIALIZATION
// ============================================================

async function startApp() {
  const app = document.getElementById('app');
  app.classList.remove('hidden');

  // Wire up nav
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Load data in parallel
  const rangeEnd   = formatDate(today());
  const rangeStart = formatDate(getNDaysAgo(84)); // 12 weeks

  const [logsRes, customRes, connRes] = await Promise.all([
    dbGetLogsForRange(rangeStart, rangeEnd),
    dbGetCustomHabits(),
    dbCheckConnection(),
  ]);

  state.logsByDate = logsRes.data || {};
  state.customHabits = customRes.data || [];
  state.connectionOk = connRes;
  state.initialized = true;

  if (!connRes) {
    setOnline(false);
    startRetryInterval();
  }

  loadHiddenBuiltins();
  switchTab('today', false); // no animation on first load
  initSwipe();
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main() {
  if (!isConfigValid()) {
    document.getElementById('setup-screen').classList.remove('hidden');
    return;
  }

  if (sessionStorage.getItem('auth') === '1') {
    // Already authenticated this session
    startApp();
  } else {
    initPin();
  }
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
