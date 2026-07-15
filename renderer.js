// =========================================================
// مدير الديون — renderer
// =========================================================

// ============ State ============
let currentPage = 'dashboard';
let selectedClientId = null;
let chartInstance = null;
let currencyPieChartInstance = null;
let directionBarChartInstance = null;
let lastDashboardData = null;
let cachedSettings = null;

// ============ DOM References ============
const sidebarItems = document.querySelectorAll('.sidebar-menu li');
const pages = document.querySelectorAll('.page');
const clientsList = document.getElementById('clients-list');
const transactionsBody = document.getElementById('transactions-body');

const modalAddClient = document.getElementById('modal-add-client');
const modalAddDebt = document.getElementById('modal-add-debt');
const modalEditClient = document.getElementById('modal-edit-client');
const modalDuplicateClient = document.getElementById('modal-duplicate-client');
const modalDayDetails = document.getElementById('modal-day-details');
const modalConfirm = document.getElementById('modal-confirm');

// ============ Security: escape user data before innerHTML ============
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============ Format Helpers ============
const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function formatNumber(num) {
  const n = Number(num);
  if (!Number.isFinite(n)) return '0';
  return numberFormatter.format(n);
}

function getCurrencySymbol(currency) {
  const symbols = { YER: 'ر.ي', SAR: 'ر.س', USD: '$' };
  return symbols[currency] || currency;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('ar-YE', { year: 'numeric', month: 'short', day: 'numeric' });
}

function avatarLetter(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0] : '؟';
}

// ============ Toast Notifications ============
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    // fallback removal in case animations are disabled
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ============ Focus Management ============
async function restoreWindowFocus() {
  try {
    await window.api.restoreFocus();
  } catch (e) {
    console.warn('Focus restore failed:', e);
  }
}

// ============ Modal Helpers ============
function openModal(modal) {
  if (modal) modal.classList.add('open');
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');
  restoreWindowFocus();
}

// Generic close: X buttons + backdrop clicks (works for all static modals)
document.querySelectorAll('.modal').forEach(modal => {
  const closeBtn = modal.querySelector('.modal-close');
  if (closeBtn) closeBtn.addEventListener('click', () => closeModal(modal));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal(modal);
  });
});

// ============ Confirm Dialog (replaces native confirm) ============
let confirmResolver = null;

function showConfirm(message, title = 'تأكيد') {
  return new Promise(resolve => {
    // resolve any previous pending confirm as cancelled
    if (confirmResolver) confirmResolver(false);
    confirmResolver = resolve;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    openModal(modalConfirm);
    document.getElementById('btn-confirm-no').focus();
  });
}

function settleConfirm(result) {
  closeModal(modalConfirm);
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

document.getElementById('btn-confirm-yes').addEventListener('click', () => settleConfirm(true));
document.getElementById('btn-confirm-no').addEventListener('click', () => settleConfirm(false));
modalConfirm.addEventListener('click', (e) => {
  if (e.target === modalConfirm) settleConfirm(false);
});

// ============ Navigation ============
sidebarItems.forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function navigateTo(pageName) {
  currentPage = pageName;
  sidebarItems.forEach(i => i.classList.remove('active'));
  document.querySelector(`.sidebar-menu li[data-page="${pageName}"]`)?.classList.add('active');
  pages.forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${pageName}`)?.classList.add('active');

  if (pageName === 'dashboard') loadDashboard();
  else if (pageName === 'clients') loadClients(document.getElementById('client-search').value.trim());
  else if (pageName === 'settings') loadSettings();
}

// ============ Theme-aware chart colors ============
const POLARITY = { positive: '#059669', negative: '#e11d48' };
const CURRENCY_COLORS = ['#6366f1', '#d97706', '#0891b2']; // YER, SAR, USD

function getChartTheme() {
  const styles = getComputedStyle(document.body);
  return {
    text: styles.getPropertyValue('--text-dim').trim() || '#a9a5c4',
    grid: styles.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)',
    surface: styles.getPropertyValue('--surface').trim() || '#131322',
  };
}

// ============ DASHBOARD ============
async function loadDashboard() {
  let data;
  try {
    data = await window.api.dashboard.summary();
  } catch (err) {
    showToast('تعذر تحميل لوحة التحكم: ' + err.message, 'error');
    return;
  }
  if (!data || data.success === false || !data.owed || !data.toPay) {
    showToast('تعذر تحميل بيانات لوحة التحكم' + (data && data.error ? ': ' + data.error : ''), 'error');
    return;
  }

  lastDashboardData = data;

  document.getElementById('dash-total-owed').textContent = formatNumber(data.owed.total_yer) + ' ر.ي';
  document.getElementById('dash-owed-detail').textContent =
    `دولار: ${formatNumber(data.owed.total_usd)} | سعودي: ${formatNumber(data.owed.total_sar)} | يمني: ${formatNumber(data.owed.total_yer_only)}`;

  document.getElementById('dash-total-to-pay').textContent = formatNumber(data.toPay.total_yer) + ' ر.ي';
  document.getElementById('dash-to-pay-detail').textContent =
    `دولار: ${formatNumber(data.toPay.total_usd)} | سعودي: ${formatNumber(data.toPay.total_sar)} | يمني: ${formatNumber(data.toPay.total_yer_only)}`;

  const netEl = document.getElementById('dash-net');
  const netLabel = document.getElementById('dash-net-label');
  netEl.textContent = formatNumber(data.net) + ' ر.ي';
  if (data.net > 0) {
    netEl.style.color = POLARITY.positive;
    netLabel.textContent = 'لك (صافي إيجابي)';
  } else if (data.net < 0) {
    netEl.style.color = POLARITY.negative;
    netLabel.textContent = 'عليك (صافي سلبي)';
  } else {
    netEl.style.color = '';
    netLabel.textContent = 'متوازن — صفر';
  }

  document.getElementById('dash-clients').textContent = data.clientCount;

  renderAllCharts();
}

function renderAllCharts() {
  if (!lastDashboardData) return;
  renderChart(lastDashboardData.last7 || []);
  renderCurrencyPieChart(lastDashboardData);
  renderDirectionBarChart(lastDashboardData);
}

function renderChart(dailyData) {
  const canvas = document.getElementById('transactionsChart');
  if (!canvas) return;
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const theme = getChartTheme();
  const today = new Date();
  const labels = [];
  const dayKeys = [];
  const amounts = [];
  const colors = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStr = d.toISOString().split('T')[0];
    dayKeys.push(dayStr);
    labels.push(d.toLocaleDateString('ar-YE', { month: 'short', day: 'numeric' }));
    const found = (dailyData || []).find(item => item.day === dayStr);
    const val = found ? found.daily_net : 0;
    amounts.push(val);
    colors.push(val >= 0 ? POLARITY.positive : POLARITY.negative);
  }

  chartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'صافي اليوم (ر.ي)',
        data: amounts,
        backgroundColor: colors,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      onHover: (event, elements) => {
        event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      },
      onClick: async (event, elements) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          await showDayDetailsModal(dayKeys[index], labels[index]);
        }
      },
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: theme.grid },
          ticks: { color: theme.text }
        },
        x: {
          grid: { display: false },
          ticks: { color: theme.text }
        }
      }
    }
  });
}

function renderCurrencyPieChart(data) {
  const canvas = document.getElementById('currencyPieChart');
  if (!canvas) return;
  if (currencyPieChartInstance) { currencyPieChartInstance.destroy(); currencyPieChartInstance = null; }

  const theme = getChartTheme();
  const totals = {
    YER: (data.owed.total_yer_only || 0) + (data.toPay.total_yer_only || 0),
    SAR: (data.owed.total_sar || 0) + (data.toPay.total_sar || 0),
    USD: (data.owed.total_usd || 0) + (data.toPay.total_usd || 0),
  };

  if (totals.YER === 0 && totals.SAR === 0 && totals.USD === 0) return;

  currencyPieChartInstance = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['ريال يمني (YER)', 'ريال سعودي (SAR)', 'دولار أمريكي (USD)'],
      datasets: [{
        data: [totals.YER, totals.SAR, totals.USD],
        backgroundColor: CURRENCY_COLORS,
        borderColor: theme.surface,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: '58%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: theme.text, padding: 16, font: { size: 12 } }
        }
      }
    }
  });
}

function renderDirectionBarChart(data) {
  const canvas = document.getElementById('directionBarChart');
  if (!canvas) return;
  if (directionBarChartInstance) { directionBarChartInstance.destroy(); directionBarChartInstance = null; }

  const theme = getChartTheme();
  directionBarChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['ديون عليك', 'ديون لك'],
      datasets: [{
        label: 'المبلغ (ر.ي)',
        data: [data.owed.total_yer || 0, data.toPay.total_yer || 0],
        backgroundColor: [POLARITY.negative, POLARITY.positive],
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: theme.grid },
          ticks: { color: theme.text }
        },
        x: {
          grid: { display: false },
          ticks: { color: theme.text, font: { size: 13 } }
        }
      }
    }
  });
}

// ============ DAY DETAILS (requirement: click a day column) ============
async function showDayDetailsModal(dayStr, dayLabel) {
  const content = document.getElementById('day-details-content');
  document.getElementById('day-details-title').textContent = `تفاصيل يوم ${dayLabel}`;

  let rows = [];
  try {
    rows = await window.api.dashboard.dayDetails(dayStr);
  } catch (err) {
    rows = [];
  }

  if (!rows || rows.length === 0) {
    content.innerHTML = '<p class="day-empty">لا توجد معاملات في هذا اليوم</p>';
  } else {
    const totalOwed = rows.filter(r => r.direction === 'له').reduce((s, r) => s + (r.total || 0), 0);
    const totalToPay = rows.filter(r => r.direction === 'عليه').reduce((s, r) => s + (r.total || 0), 0);

    content.innerHTML = `
      <div class="day-summary-totals">
        <div class="day-total day-total-to-pay">
          <span class="day-total-label">إجمالي عليه (لك)</span>
          <span class="day-total-value">${formatNumber(totalToPay)} ر.ي</span>
        </div>
        <div class="day-total day-total-owed">
          <span class="day-total-label">إجمالي له (عليك)</span>
          <span class="day-total-value">${formatNumber(totalOwed)} ر.ي</span>
        </div>
      </div>
      ${rows.map(r => `
        <div class="day-detail-row">
          <span class="day-detail-client">${escapeHtml(r.name)}</span>
          <span class="day-detail-amount ${r.direction === 'عليه' ? 'dir-to-pay' : 'dir-owed'}">
            ${formatNumber(r.total)} ر.ي ${r.direction === 'عليه' ? 'عليه' : 'له'}
          </span>
        </div>
      `).join('')}
    `;
  }

  openModal(modalDayDetails);
}

// ============ CLIENTS (sorting + search) ============
let clientSortBy = 'name';
let clientSortDir = 'asc';

function sortClientsLocal(clients, sortBy, sortDir) {
  return [...clients].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') {
      cmp = (a.name || '').localeCompare((b.name || ''), 'ar');
    } else if (sortBy === 'modified') {
      const av = a.last_modified ? new Date(a.last_modified).getTime() : 0;
      const bv = b.last_modified ? new Date(b.last_modified).getTime() : 0;
      cmp = av - bv;
    } else if (sortBy === 'net') {
      cmp = Number(a.net_balance || 0) - Number(b.net_balance || 0);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });
}

function applySortControlsState() {
  const select = document.getElementById('sort-by');
  const dirLabel = document.getElementById('sort-dir-label');
  if (select) select.value = clientSortBy;
  if (dirLabel) dirLabel.textContent = clientSortDir === 'desc' ? 'تنازلي' : 'تصاعدي';
}

function persistSortSettings() {
  // fire-and-forget; sorting must not block on IPC
  window.api.settings.set({ key: 'clientSortBy', value: clientSortBy }).catch(() => {});
  window.api.settings.set({ key: 'clientSortDir', value: clientSortDir }).catch(() => {});
}

async function loadClients(searchTerm = '') {
  let clients;
  try {
    if (searchTerm) {
      clients = await window.api.clients.search(searchTerm);
      clients = sortClientsLocal(clients, clientSortBy, clientSortDir);
    } else {
      clients = await window.api.clients.getAllSorted({ sortBy: clientSortBy, sortDir: clientSortDir });
    }
  } catch (err) {
    showToast('تعذر تحميل العملاء: ' + err.message, 'error');
    return;
  }

  const countSub = document.getElementById('clients-count-sub');
  if (countSub) {
    countSub.textContent = clients.length === 0
      ? 'لا يوجد عملاء بعد'
      : `${clients.length} عميل مسجّل`;
  }

  if (clients.length === 0) {
    clientsList.innerHTML = `
      <div class="empty-state">
        <p>${searchTerm ? 'لا توجد نتائج مطابقة للبحث' : 'لا يوجد عملاء بعد'}</p>
        <p>${searchTerm ? 'جرّب كلمة بحث أخرى' : 'اضغط «إضافة عميل» للبدء'}</p>
      </div>
    `;
    return;
  }

  clientsList.innerHTML = clients.map(c => {
    const net = Number(c.net_balance || 0);
    const netClass = net > 0 ? 'balance-positive' : (net < 0 ? 'balance-negative' : 'balance-zero');
    const netLabel = net > 0 ? 'عليه (لك)' : (net < 0 ? 'له (عليك)' : 'متوازن');
    return `
    <div class="client-card" data-client-id="${c.id}">
      <div class="client-avatar">${escapeHtml(avatarLetter(c.name))}</div>
      <div class="client-info">
        <h3>${escapeHtml(c.name)}</h3>
        <div class="client-phone">${escapeHtml(c.phone || 'لا يوجد رقم')}</div>
      </div>
      <div class="client-balance">
        <span class="balance-amount ${netClass}">${formatNumber(net)} ر.ي</span>
        <span class="balance-label">${netLabel}</span>
      </div>
    </div>
  `}).join('');

  clientsList.querySelectorAll('.client-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedClientId = parseInt(card.dataset.clientId);
      showClientDetail(selectedClientId);
    });
  });
}

// Search with debounce
let searchDebounce = null;
document.getElementById('client-search').addEventListener('input', (e) => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadClients(e.target.value.trim()), 250);
});

// Sort field change — «net» defaults to descending (largest debt first)
document.getElementById('sort-by').addEventListener('change', (e) => {
  clientSortBy = e.target.value;
  clientSortDir = clientSortBy === 'net' ? 'desc' : (clientSortBy === 'modified' ? 'desc' : 'asc');
  applySortControlsState();
  persistSortSettings();
  loadClients(document.getElementById('client-search').value.trim());
});

// Sort direction toggle
document.getElementById('btn-sort-dir').addEventListener('click', () => {
  clientSortDir = clientSortDir === 'asc' ? 'desc' : 'asc';
  applySortControlsState();
  persistSortSettings();
  loadClients(document.getElementById('client-search').value.trim());
});

// ============ CLIENT DETAIL ============
async function showClientDetail(clientId) {
  let client, transactions;
  try {
    client = await window.api.clients.getById(clientId);
    transactions = await window.api.transactions.getByClient(clientId);
  } catch (err) {
    showToast('تعذر تحميل بيانات العميل: ' + err.message, 'error');
    return;
  }
  if (!client) {
    showToast('العميل غير موجود', 'error');
    return;
  }

  selectedClientId = clientId;

  document.getElementById('page-clients').classList.remove('active');
  document.getElementById('page-client-detail').classList.add('active');

  document.getElementById('detail-avatar').textContent = avatarLetter(client.name);
  document.getElementById('detail-client-name').textContent = client.name;
  document.getElementById('detail-client-phone').textContent = client.phone || 'لا يوجد رقم';
  document.getElementById('detail-total-owed').textContent = formatNumber(client.total_owed || 0) + ' ر.ي';
  document.getElementById('detail-total-to-pay').textContent = formatNumber(client.total_to_pay || 0) + ' ر.ي';

  const netBalance = Number(client.net_balance || 0);
  const netClass = netBalance > 0 ? 'balance-positive' : (netBalance < 0 ? 'balance-negative' : 'balance-zero');
  const netLabel = netBalance > 0 ? 'عليه (لك)' : (netBalance < 0 ? 'له (عليك)' : 'متوازن');
  document.getElementById('detail-net-summary').innerHTML =
    `<span>صافي الرصيد</span><strong class="${netClass}">${formatNumber(netBalance)} ر.ي — ${netLabel}</strong>`;

  if (transactions.length === 0) {
    transactionsBody.innerHTML = `
      <tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text-faint);">
        لا توجد معاملات بعد — اضغط «إضافة دين» للبدء
      </td></tr>
    `;
    return;
  }

  transactionsBody.innerHTML = transactions.map(t => {
    const rateDisplay = t.rate_at_time && t.rate_at_time > 1
      ? `${formatNumber(t.converted_amount || t.amount)} (سعر ${formatNumber(t.rate_at_time)})`
      : formatNumber(t.converted_amount || t.amount);
    const dirClass = t.direction === 'عليه' ? 'dir-to-pay' : 'dir-owed';
    return `
    <tr>
      <td>${escapeHtml(t.item_name)}</td>
      <td>${formatNumber(t.amount)}</td>
      <td>${getCurrencySymbol(t.currency)}</td>
      <td>${rateDisplay}</td>
      <td><span class="direction-badge ${dirClass}">${escapeHtml(t.direction)}</span></td>
      <td>${formatDate(t.created_at)}</td>
      <td>
        <div class="table-actions">
          <button class="btn btn-secondary btn-sm btn-edit-transaction" data-id="${t.id}">تعديل</button>
          <button class="btn btn-danger btn-sm btn-delete-transaction" data-id="${t.id}">حذف</button>
        </div>
      </td>
    </tr>
  `}).join('');

  transactionsBody.querySelectorAll('.btn-edit-transaction').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      const transaction = transactions.find(t => t.id === id);
      if (transaction) showEditModal(transaction);
    });
  });

  transactionsBody.querySelectorAll('.btn-delete-transaction').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await showConfirm('هل أنت متأكد من حذف هذا الدين؟', 'حذف دين');
      if (!ok) return;
      const result = await window.api.transactions.delete(parseInt(btn.dataset.id));
      if (result && result.success === false) {
        showToast('فشل الحذف: ' + result.error, 'error');
        return;
      }
      showToast('تم حذف الدين', 'success');
      showClientDetail(selectedClientId);
    });
  });
}

// ============ ADD CLIENT ============
let lastNewClientData = { name: '', phone: '' };

document.getElementById('btn-add-client').addEventListener('click', () => {
  document.getElementById('client-name').value = '';
  document.getElementById('client-phone').value = '';
  openModal(modalAddClient);
  document.getElementById('client-name').focus();
});

document.getElementById('form-add-client').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('client-name').value.trim();
  const phone = document.getElementById('client-phone').value.trim();
  if (!name) return;

  lastNewClientData = { name, phone };

  let result;
  try {
    result = await window.api.clients.add({ name, phone });
  } catch (err) {
    showToast('تعذر إضافة العميل: ' + err.message, 'error');
    return;
  }

  if (result.duplicate) {
    showDuplicateClientModal(result);
    return;
  }

  closeModal(modalAddClient);
  showToast(`تمت إضافة العميل «${name}» بنجاح`, 'success');

  // Requirement: go straight to the new client's page to start adding debts
  navigateTo('clients');
  await showClientDetail(result.id);
});

// ============ DUPLICATE CLIENT MODAL ============
let pendingDuplicateData = null;

function showDuplicateClientModal(data) {
  pendingDuplicateData = data;
  const existing = data.existingClient;
  const matchType = data.matchType;

  let message = '';
  if (matchType === 'both') {
    message = `يوجد عميل بنفس الاسم <strong>${escapeHtml(existing.name)}</strong> ونفس الرقم <strong>${escapeHtml(existing.phone)}</strong>`;
  } else if (matchType === 'name') {
    message = `يوجد عميل بنفس الاسم: <strong>${escapeHtml(existing.name)}</strong>`;
    if (existing.phone) message += ` (الرقم: ${escapeHtml(existing.phone)})`;
  } else if (matchType === 'phone') {
    message = `يوجد عميل بنفس الرقم: <strong>${escapeHtml(existing.phone)}</strong> (الاسم: ${escapeHtml(existing.name)})`;
  }

  document.getElementById('duplicate-message').innerHTML = message;
  openModal(modalDuplicateClient);
}

document.getElementById('btn-duplicate-edit').addEventListener('click', () => {
  closeModal(modalDuplicateClient);
  document.getElementById('client-name').value = lastNewClientData.name;
  document.getElementById('client-phone').value = lastNewClientData.phone;
  openModal(modalAddClient);
  document.getElementById('client-name').focus();
});

document.getElementById('btn-duplicate-navigate').addEventListener('click', () => {
  if (!pendingDuplicateData) return;
  const existing = pendingDuplicateData.existingClient;
  closeModal(modalDuplicateClient);
  closeModal(modalAddClient);
  pendingDuplicateData = null;
  navigateTo('clients');
  showClientDetail(existing.id);
});

document.getElementById('btn-duplicate-close').addEventListener('click', () => {
  closeModal(modalDuplicateClient);
  pendingDuplicateData = null;
});

// ============ EDIT CLIENT ============
document.getElementById('btn-edit-client').addEventListener('click', async () => {
  if (!selectedClientId) return;
  try {
    const client = await window.api.clients.getById(selectedClientId);
    document.getElementById('edit-client-name').value = client.name || '';
    document.getElementById('edit-client-phone').value = client.phone || '';
  } catch (err) {
    showToast('تعذر تحميل بيانات العميل', 'error');
    return;
  }
  openModal(modalEditClient);
  document.getElementById('edit-client-name').focus();
});

document.getElementById('form-edit-client').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('edit-client-name').value.trim();
  const phone = document.getElementById('edit-client-phone').value.trim();
  if (!name || !selectedClientId) return;
  const result = await window.api.clients.update({ id: selectedClientId, name, phone });
  if (result && (result.error || result.success === false)) {
    showToast('حدث خطأ: ' + (result.error || 'فشل التعديل'), 'error');
    return;
  }
  closeModal(modalEditClient);
  showToast('تم حفظ بيانات العميل', 'success');
  showClientDetail(selectedClientId);
});

// ============ PDF EXPORT ============
document.getElementById('btn-export-pdf').addEventListener('click', async () => {
  if (!selectedClientId) return;
  const btn = document.getElementById('btn-export-pdf');
  const originalHtml = btn.innerHTML;
  btn.textContent = 'جاري الإنشاء...';
  btn.disabled = true;
  try {
    const result = await window.api.exportClientPdf(selectedClientId);
    if (result.success) {
      showToast('تم حفظ كشف الحساب بنجاح', 'success', 5000);
    } else if (result.error && result.error !== 'تم الإلغاء') {
      showToast('فشل إنشاء PDF: ' + result.error, 'error', 5000);
    }
  } catch (err) {
    showToast('خطأ: ' + err.message, 'error');
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
});

// ============ DIRECTION PICKER (add-debt modal) ============
function setAddDebtDirection(direction) {
  document.querySelectorAll('#add-direction-options .direction-option').forEach(option => {
    const isMatch = option.dataset.direction === direction;
    option.classList.toggle('selected', isMatch);
    const radio = option.querySelector('input[type="radio"]');
    if (radio) radio.checked = isMatch;
  });
}

document.querySelectorAll('#add-direction-options .direction-option').forEach(option => {
  option.addEventListener('click', () => setAddDebtDirection(option.dataset.direction));
});

// ============ ADD DEBT ============
document.getElementById('btn-add-debt').addEventListener('click', () => {
  document.getElementById('debt-item').value = '';
  document.getElementById('debt-amount').value = '';
  // Requirement: «عليه» is ALWAYS the default, on every open, for every client
  setAddDebtDirection('عليه');
  openModal(modalAddDebt);
  document.getElementById('debt-item').focus();
  updateConversionPreview();
});

document.getElementById('debt-amount').addEventListener('input', updateConversionPreview);
document.getElementById('debt-currency').addEventListener('change', updateConversionPreview);

async function getSettingsCached() {
  if (!cachedSettings) {
    cachedSettings = await window.api.settings.getAll();
  }
  return cachedSettings;
}

async function updateConversionPreview() {
  const amount = parseFloat(document.getElementById('debt-amount').value) || 0;
  const currency = document.getElementById('debt-currency').value;
  const settings = await getSettingsCached();

  let rateText;
  let converted = amount;
  if (currency === 'USD') {
    rateText = `1 USD = ${settings.usd_to_yer} ر.ي`;
    converted = amount * parseFloat(settings.usd_to_yer);
  } else if (currency === 'SAR') {
    rateText = `1 SAR = ${settings.sar_to_yer} ر.ي`;
    converted = amount * parseFloat(settings.sar_to_yer);
  } else {
    rateText = 'ريال يمني — بدون تحويل';
  }

  if (amount > 0 && currency !== 'YER') {
    rateText += ` ← ${formatNumber(converted)} ر.ي`;
  }
  document.getElementById('preview-rate').textContent = rateText;
}

document.getElementById('form-add-debt').addEventListener('submit', async (e) => {
  e.preventDefault();
  const item_name = document.getElementById('debt-item').value.trim();
  const amount = parseFloat(document.getElementById('debt-amount').value);
  const currency = document.getElementById('debt-currency').value;
  const checked = document.querySelector('input[name="debt-direction"]:checked');
  const direction = checked ? checked.value : 'عليه';

  if (!item_name || !amount || amount <= 0) {
    showToast('أدخل اسم الصنف ومبلغاً صحيحاً', 'error');
    return;
  }
  if (!selectedClientId) {
    showToast('لم يتم تحديد العميل', 'error');
    return;
  }

  const result = await window.api.transactions.add({
    client_id: selectedClientId,
    item_name,
    amount,
    currency,
    direction
  });

  if (result && (result.error || result.success === false)) {
    showToast('حدث خطأ: ' + (result.error || 'فشل إضافة الدين'), 'error');
    return;
  }

  closeModal(modalAddDebt);
  showToast('تمت إضافة الدين بنجاح', 'success');
  showClientDetail(selectedClientId);
});

// ============ DELETE CLIENT ============
document.getElementById('btn-delete-client').addEventListener('click', async () => {
  if (!selectedClientId) return;
  const ok = await showConfirm('هل أنت متأكد من حذف هذا العميل؟ سيتم حذف جميع ديونه أيضاً.', 'حذف عميل');
  if (!ok) return;
  await window.api.clients.delete(selectedClientId);
  selectedClientId = null;
  showToast('تم حذف العميل وجميع ديونه', 'success');
  navigateTo('clients');
});

// ============ BACK TO CLIENTS ============
document.getElementById('btn-back-clients').addEventListener('click', () => {
  navigateTo('clients');
});

// ============ EDIT TRANSACTION (dynamic modal) ============
let editingTransactionId = null;

function showEditModal(transaction) {
  editingTransactionId = transaction.id;

  let modal = document.getElementById('modal-edit-debt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-edit-debt';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <span class="modal-close">&times;</span>
        <h2>تعديل الدين</h2>
        <form id="form-edit-debt">
          <div class="form-group">
            <label for="edit-debt-item">اسم الصنف *</label>
            <input type="text" id="edit-debt-item" required placeholder="مثال: جوال S22 Ultra" />
          </div>
          <div class="form-group">
            <label for="edit-debt-amount">المبلغ *</label>
            <input type="number" id="edit-debt-amount" required step="0.01" min="0" placeholder="0.00" />
          </div>
          <div class="form-group">
            <label for="edit-debt-currency">العملة</label>
            <select id="edit-debt-currency">
              <option value="YER">ريال يمني (YER)</option>
              <option value="SAR">ريال سعودي (SAR)</option>
              <option value="USD">دولار أمريكي (USD)</option>
            </select>
          </div>
          <div class="form-group">
            <label>اتجاه الدين</label>
            <div class="direction-options" id="edit-direction-options">
              <label class="direction-option dir-to-pay" data-direction="عليه">
                <input type="radio" name="edit-debt-direction" value="عليه">
                <span class="radio-text">عليه (دين لك)</span>
                <span class="radio-desc">العميل يعطيك — موجب</span>
                <span class="check-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                </span>
              </label>
              <label class="direction-option dir-owed" data-direction="له">
                <input type="radio" name="edit-debt-direction" value="له">
                <span class="radio-text">له (دين عليك)</span>
                <span class="radio-desc">أنت تعطي العميل — سالب</span>
                <span class="check-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                </span>
              </label>
            </div>
          </div>
          <div class="btn-row" style="margin-top:16px;">
            <button type="submit" class="btn btn-primary" style="flex:1;">حفظ التعديلات</button>
            <button type="button" class="btn btn-secondary" id="btn-edit-debt-cancel">إلغاء</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('.modal-close').addEventListener('click', () => closeModal(modal));
    modal.querySelector('#btn-edit-debt-cancel').addEventListener('click', () => closeModal(modal));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(modal);
    });
    modal.querySelectorAll('.direction-option').forEach(option => {
      option.addEventListener('click', () => {
        modal.querySelectorAll('.direction-option').forEach(o => {
          const isMatch = o === option;
          o.classList.toggle('selected', isMatch);
          const radio = o.querySelector('input[type="radio"]');
          if (radio) radio.checked = isMatch;
        });
      });
    });
  }

  document.getElementById('edit-debt-item').value = transaction.item_name;
  document.getElementById('edit-debt-amount').value = transaction.amount;
  document.getElementById('edit-debt-currency').value = transaction.currency;

  modal.querySelectorAll('.direction-option').forEach(o => {
    const isMatch = o.dataset.direction === transaction.direction;
    o.classList.toggle('selected', isMatch);
    const radio = o.querySelector('input[type="radio"]');
    if (radio) radio.checked = isMatch;
  });

  openModal(modal);
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'form-edit-debt') return;
  e.preventDefault();
  const item_name = document.getElementById('edit-debt-item').value.trim();
  const amount = parseFloat(document.getElementById('edit-debt-amount').value);
  const currency = document.getElementById('edit-debt-currency').value;
  const checked = document.querySelector('input[name="edit-debt-direction"]:checked');
  const direction = checked ? checked.value : 'عليه';

  if (!item_name || !amount || amount <= 0) {
    showToast('أدخل اسم الصنف ومبلغاً صحيحاً', 'error');
    return;
  }

  const result = await window.api.transactions.update({
    id: editingTransactionId,
    item_name,
    amount,
    currency,
    direction
  });

  if (result && result.success === false) {
    showToast('حدث خطأ: ' + result.error, 'error');
    return;
  }

  closeModal(document.getElementById('modal-edit-debt'));
  editingTransactionId = null;
  showToast('تم حفظ التعديلات', 'success');
  showClientDetail(selectedClientId);
});

// ============ SETTINGS ============
function setBackupStatus(message, ok) {
  const el = document.getElementById('backup-status');
  el.textContent = message;
  el.className = ok === undefined ? '' : (ok ? 'status-ok' : 'status-error');
}

async function loadSettings() {
  const settings = await window.api.settings.getAll();
  cachedSettings = settings;
  document.getElementById('usd-rate').value = settings.usd_to_yer || '2500';
  document.getElementById('sar-rate').value = settings.sar_to_yer || '666';
  document.getElementById('backup-path').value = settings.backup_path || '';
  document.getElementById('auto-backup').checked = settings.auto_backup === 'true';
  setBackupStatus('');
}

document.getElementById('btn-save-rates').addEventListener('click', async () => {
  const usdRate = parseFloat(document.getElementById('usd-rate').value);
  const sarRate = parseFloat(document.getElementById('sar-rate').value);
  if (!usdRate || usdRate <= 0 || !sarRate || sarRate <= 0) {
    showToast('الرجاء إدخال أسعار صرف صحيحة أكبر من صفر', 'error');
    return;
  }
  await window.api.settings.set({ key: 'usd_to_yer', value: String(usdRate) });
  await window.api.settings.set({ key: 'sar_to_yer', value: String(sarRate) });
  cachedSettings = null; // refresh cache next time it's needed
  showToast('تم حفظ أسعار الصرف بنجاح', 'success');
});

document.getElementById('browse-btn').addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) document.getElementById('backup-path').value = folder;
});

document.getElementById('btn-save-backup-path').addEventListener('click', async () => {
  const backupPath = document.getElementById('backup-path').value.trim();
  const autoBackup = document.getElementById('auto-backup').checked ? 'true' : 'false';
  if (!backupPath) {
    setBackupStatus('الرجاء اختيار مسار صحيح أولاً', false);
    return;
  }
  await window.api.settings.set({ key: 'backup_path', value: backupPath });
  await window.api.settings.set({ key: 'auto_backup', value: autoBackup });
  setBackupStatus('تم حفظ إعدادات النسخ الاحتياطي بنجاح', true);
});

document.getElementById('btn-backup-now').addEventListener('click', async () => {
  const backupPath = document.getElementById('backup-path').value.trim();
  if (!backupPath) {
    setBackupStatus('الرجاء تعيين مسار النسخ الاحتياطي أولاً', false);
    return;
  }
  await window.api.settings.set({ key: 'backup_path', value: backupPath });
  const result = await window.api.backup.create();
  if (result.success) {
    setBackupStatus(`تم حفظ النسخة الاحتياطية في: ${result.path}`, true);
    showToast('تم إنشاء النسخة الاحتياطية', 'success');
  } else {
    setBackupStatus(`فشل النسخ الاحتياطي: ${result.error}`, false);
  }
});

document.getElementById('btn-restore-backup').addEventListener('click', async () => {
  const ok = await showConfirm('استعادة النسخة الاحتياطية ستستبدل جميع البيانات الحالية. هل أنت متأكد؟', 'استعادة نسخة احتياطية');
  if (!ok) return;
  const filePath = await window.api.openFile();
  if (!filePath) return;
  const restoreResult = await window.api.backup.restore(filePath);
  if (restoreResult.success) {
    setBackupStatus('تم استعادة النسخة الاحتياطية بنجاح', true);
    showToast('تم استعادة البيانات — يتم إعادة التحميل...', 'success');
    setTimeout(() => location.reload(), 1200);
  } else {
    setBackupStatus(`فشل الاستعادة: ${restoreResult.error}`, false);
  }
});

document.getElementById('auto-backup').addEventListener('change', async (e) => {
  const autoBackup = e.target.checked ? 'true' : 'false';
  await window.api.settings.set({ key: 'auto_backup', value: autoBackup });
});

// Theme switching — re-render charts so they pick up the new colors
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const theme = btn.dataset.theme;
    document.body.className = `theme-${theme}`;
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderAllCharts();
    await window.api.settings.set({ key: 'theme', value: theme });
  });
});

// ============ INIT ============
async function init() {
  let settings = {};
  try {
    settings = await window.api.settings.getAll();
    cachedSettings = settings;
  } catch (err) {
    showToast('تعذر تحميل الإعدادات', 'error');
  }

  const theme = settings.theme === 'light' ? 'light' : 'dark';
  document.body.className = `theme-${theme}`;
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });

  if (settings.clientSortBy && ['name', 'modified', 'net'].includes(settings.clientSortBy)) {
    clientSortBy = settings.clientSortBy;
  }
  if (settings.clientSortDir === 'asc' || settings.clientSortDir === 'desc') {
    clientSortDir = settings.clientSortDir;
  }
  applySortControlsState();

  loadDashboard();
}

init();
