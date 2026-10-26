const translations = {};
let currentLanguage = localStorage.getItem('language') === 'en' ? 'en' : 'sw';
let currentUser = null;
let reportData = { reports: [], periods: [], departments: [] };
let adminData = { users: [], departments: [], roles: [] };
let notificationData = { notifications: [], unreadCount: 0 };
let editingReportId = null;
let messageTimeout;

const loginView = document.querySelector('#login-view');
const dashboardView = document.querySelector('#dashboard-view');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const languageSelect = document.querySelector('#language-select');
const reportList = document.querySelector('#report-list');
const reportForm = document.querySelector('#report-form');
const periodForm = document.querySelector('#period-form');
const passwordDialog = document.querySelector('#password-dialog');
const passwordForm = document.querySelector('#change-password-form');
const passwordChangeError = document.querySelector('#password-change-error');

function arrangeDashboardPages() {
  const overviewPage = document.querySelector('#overview-page');
  const reportsPage = document.querySelector('#reports-page');
  const periodsPage = document.querySelector('#periods-page');
  const organizationPage = document.querySelector('#organization-page');
  const workspace = document.querySelector('#reports-workspace');

  overviewPage.append(document.querySelector('#dashboard-stats'));
  reportsPage.append(
    workspace.querySelector('.workspace-toolbar'),
    workspace.querySelector('.report-filters'),
    reportForm,
    document.querySelector('#report-list')
  );
  periodsPage.append(periodForm);
  organizationPage.append(document.querySelector('#admin-workspace'));
  workspace.remove();
}

arrangeDashboardPages();

function setDashboardPage(page) {
  const allowedPage = page === 'periods' || page === 'organization'
    ? currentUser?.role === 'admin' ? page : 'overview'
    : ['overview', 'reports'].includes(page) ? page : 'overview';
  document.querySelectorAll('[data-dashboard-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.dashboardPanel !== allowedPage;
  });
  document.querySelectorAll('[data-dashboard-page]').forEach((link) => {
    const active = link.dataset.dashboardPage === allowedPage;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-dashboard-role]').forEach((link) => {
    link.hidden = link.dataset.dashboardRole !== currentUser?.role;
  });
  const titleKey = {
    overview: 'dashboard',
    reports: 'monthlyReporting',
    periods: 'reportingPeriods',
    organization: 'manageOrganization'
  }[allowedPage];
  document.querySelector('#dashboard-title').textContent = translate(titleKey);
  if (window.location.hash !== `#${allowedPage}`) {
    window.history.replaceState(null, '', `#${allowedPage}`);
  }
}

function translate(key) {
  return translations[currentLanguage]?.[key] || key;
}

function setAccountTheme(user) {
  const root = document.documentElement;
  if (!user) {
    root.style.removeProperty('--green');
    root.style.removeProperty('--green-dark');
    root.style.removeProperty('--theme-soft');
    root.style.removeProperty('--theme-focus');
    root.style.removeProperty('--page-bg');
    return;
  }
  const id = Number(user.id);
  const hue = Number.isSafeInteger(id) && id > 0 ? (id * 137.508) % 360 : 150;
  root.style.setProperty('--green', `hsl(${hue.toFixed(1)} 48% 32%)`);
  root.style.setProperty('--green-dark', `hsl(${hue.toFixed(1)} 52% 24%)`);
  root.style.setProperty('--theme-soft', `hsl(${hue.toFixed(1)} 35% 95%)`);
  root.style.setProperty('--theme-focus', `hsl(${hue.toFixed(1)} 52% 24%)`);
  root.style.setProperty('--page-bg', `hsl(${hue.toFixed(1)} 20% 98%)`);
}

async function loadTranslations(language) {
  if (!translations[language]) {
    const response = await fetch(`/languages/${language}.json`);
    if (!response.ok) throw new Error('Could not load language file');
    translations[language] = await response.json();
  }
  return translations[language];
}

async function setLanguage(language, persist = true) {
  currentLanguage = language;
  localStorage.setItem('language', language);
  document.documentElement.lang = language;
  languageSelect.value = language;
  const dictionary = await loadTranslations(language);
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const text = dictionary[element.dataset.i18n];
    if (text) element.textContent = text;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const text = dictionary[element.dataset.i18nPlaceholder];
    if (text) element.placeholder = text;
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    const text = dictionary[element.dataset.i18nAriaLabel];
    if (text) element.setAttribute('aria-label', text);
  });
  if (currentUser) {
    const roleText = dictionary[`role_${currentUser.role}`] || currentUser.role;
    document.querySelector('#role-label').textContent = roleText;
    document.querySelector('#role-chip').textContent = roleText;
    document.querySelector('#greeting').textContent = `${currentUser.displayName}`;
    document.querySelector('#sidebar-user-name').textContent = currentUser.displayName;
    document.querySelector('#sidebar-user-role').textContent = roleText;
    document.querySelector('#sidebar-avatar').textContent = currentUser.displayName.trim().charAt(0).toLocaleUpperCase(currentLanguage);
    document.querySelector('#overview-user-name').textContent = currentUser.displayName;
    const overviewHints = {
      admin: 'overviewAdminHint',
      member: 'memberReportsHint',
      department_head: 'headOverviewHint',
      secretary: 'secretaryOverviewHint',
      vice_chairperson: 'viceOverviewHint',
      chairperson: 'chairOverviewHint'
    };
    document.querySelector('#overview-welcome-copy').textContent = translate(overviewHints[currentUser.role] || 'reviewReportsHint');
    document.querySelector('#overview-date').textContent = new Intl.DateTimeFormat(currentLanguage, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }).format(new Date());
    if (persist) {
      requestJson('/api/auth/language', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language })
      }).catch((error) => showGlobalMessage(`error_${error.message}`));
    }
    document.querySelector('#dashboard-title').textContent = translate({
      overview: 'dashboard',
      reports: 'monthlyReporting',
      periods: 'reportingPeriods',
      organization: 'manageOrganization'
    }[document.querySelector('[data-dashboard-panel]:not([hidden])')?.dataset.dashboardPanel || 'overview']);
    renderReports();
    renderAdmin();
    renderNotifications();
  }
}

function showView(view) {
  loginView.hidden = view !== 'login';
  dashboardView.hidden = view !== 'dashboard';
}

function showLoginError(key) {
  loginError.textContent = translate(`error_${key}`);
  if (loginError.textContent === `error_${key}`) {
    loginError.textContent = translate('error_internal_server_error');
  }
  loginError.hidden = false;
}

function showGlobalMessage(key) {
  const message = document.querySelector('#global-message');
  message.textContent = translate(key);
  message.hidden = false;
  window.clearTimeout(messageTimeout);
  messageTimeout = window.setTimeout(() => {
    message.hidden = true;
  }, 4500);
}

function clearSignedInState() {
  currentUser = null;
  setAccountTheme(null);
  reportData = { reports: [], periods: [], departments: [] };
  adminData = { users: [], departments: [], roles: [] };
  notificationData = { notifications: [], unreadCount: 0 };
  document.querySelector('#notifications-panel').hidden = true;
  document.querySelector('#notifications-toggle').setAttribute('aria-expanded', 'false');
  renderNotifications();
  reportForm.hidden = true;
  periodForm.hidden = true;
  showView('login');
}

function showRequestError(element, error) {
  element.textContent = translate(`error_${error.message}`);
  if (element.textContent === `error_${error.message}`) {
    element.textContent = translate('error_internal_server_error');
  }
  element.hidden = false;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(result?.error || 'internal_server_error');
  return result;
}

function renderNotifications() {
  const list = document.querySelector('#notification-list');
  const toggle = document.querySelector('#notifications-toggle');
  list.replaceChildren();
  toggle.textContent = `${translate('notifications')} (${notificationData.unreadCount})`;
  if (!notificationData.notifications.length) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = translate('noNotifications');
    list.append(empty);
    return;
  }
  notificationData.notifications.forEach((notification) => {
    const row = document.createElement('article');
    row.className = `notification-row${notification.isRead ? '' : ' notification-unread'}`;
    const message = document.createElement('p');
    message.textContent = translate(`notification_${notification.messageKey}`);
    const date = document.createElement('time');
    date.dateTime = notification.createdAt;
    date.textContent = new Date(notification.createdAt).toLocaleString(currentLanguage);
    row.append(message, date);
    if (!notification.isRead) {
      const markRead = document.createElement('button');
      markRead.type = 'button';
      markRead.className = 'quiet-button';
      markRead.dataset.notificationRead = notification.id;
      markRead.textContent = translate('markRead');
      row.append(markRead);
    }
    list.append(row);
  });
}

async function loadNotifications() {
  try {
    notificationData = await requestJson('/api/notifications');
    renderNotifications();
  } catch (error) {
    showGlobalMessage(`error_${error.message}`);
  }
}

function renderReportHistory(container, history) {
  const list = document.createElement('ol');
  list.className = 'history-list';
  const events = [
    ...history.revisions.map((entry) => ({ ...entry, type: 'revision' })),
    ...history.approvals.map((entry) => ({ ...entry, type: 'approval' }))
  ].sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt));
  events.forEach((entry) => {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    const isRevision = entry.type === 'revision';
    title.textContent = isRevision
      ? translate('revisionSaved').replace('{version}', entry.version)
      : `${translate(`stage_${entry.stage}`)} · ${translate(`decision_${entry.decision}`)}`;
    const detail = document.createElement('span');
    detail.textContent = isRevision
      ? `${entry.author} · ${translate(`status_${entry.status}`)} · ${new Date(entry.createdAt).toLocaleString(currentLanguage)}`
      : `${entry.reviewer} · ${new Date(entry.createdAt).toLocaleString(currentLanguage)}`;
    item.append(title, detail);
    if (!isRevision && entry.comment) {
      const comment = document.createElement('p');
      comment.textContent = entry.comment;
      item.append(comment);
    }
    list.append(item);
  });
  if (!list.childElementCount) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = translate('noReportHistory');
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(list);
}

function openPeriods() {
  return reportData.periods.filter((period) => period.isOpen);
}

function reportPeriodLabel(period) {
  return `${translate(`month_${period.month}`)} ${period.year}`;
}

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function populateReportFormOptions(periodId, departmentId) {
  const periodSelect = document.querySelector('#report-period');
  const departmentSelect = document.querySelector('#report-department');
  const availablePeriods = DashboardMetrics.getAvailableReportPeriods(
    currentUser,
    reportData.reports,
    openPeriods(),
    reportData.departments
  );
  periodSelect.replaceChildren();
  availablePeriods.forEach((period) => appendOption(periodSelect, period.id, reportPeriodLabel(period)));
  if (periodId && availablePeriods.some((period) => period.id === periodId)) {
    periodSelect.value = String(periodId);
  }
  const selectedPeriodId = Number(periodSelect.value);
  const availableDepartments = DashboardMetrics.getAvailableReportDepartments(
    currentUser,
    reportData.reports,
    selectedPeriodId,
    reportData.departments
  );
  departmentSelect.replaceChildren();
  availableDepartments.forEach((department) => appendOption(departmentSelect, department.id, department.name));
  if (departmentId && availableDepartments.some((department) => department.id === departmentId)) {
    departmentSelect.value = String(departmentId);
  }
  return availablePeriods.length > 0 && availableDepartments.length > 0;
}

function appendReportField(parent, label, value) {
  const wrapper = document.createElement('div');
  wrapper.className = 'report-detail';
  const heading = document.createElement('strong');
  heading.textContent = label;
  const text = document.createElement('p');
  text.textContent = value || translate('notProvided');
  wrapper.append(heading, text);
  parent.append(wrapper);
}

function createReportCard(report) {
  const card = document.createElement('article');
  card.className = 'report-card';
  card.dataset.reportId = report.id;
  const heading = document.createElement('div');
  heading.className = 'report-card-heading';
  const title = document.createElement('h2');
  title.textContent = `${report.departmentName} · ${reportPeriodLabel({
    month: report.periodMonth,
    year: report.periodYear
  })}`;
  const status = document.createElement('span');
  status.className = `status-chip status-${report.status}`;
  status.textContent = translate(`status_${report.status}`);
  heading.append(title, status);

  const metadata = document.createElement('div');
  metadata.className = 'report-card-meta';
  const owner = document.createElement('span');
  owner.className = 'report-card-owner';
  owner.textContent = `${translate('submittedBy')}: ${report.submittedBy}`;
  metadata.append(owner);
  if (report.submittedAt) {
    const submitted = document.createElement('time');
    submitted.dateTime = report.submittedAt;
    submitted.textContent = `${translate('submittedOn')}: ${new Intl.DateTimeFormat(currentLanguage, {
      year: 'numeric', month: 'short', day: 'numeric'
    }).format(new Date(report.submittedAt))}`;
    metadata.append(submitted);
  }

  const metrics = document.createElement('div');
  metrics.className = 'report-metrics';
  [
    [translate('beneficiariesReached'), report.beneficiariesReached],
    [translate('sessionsHeld'), report.sessionsHeld]
  ].forEach(([label, value]) => {
    const metric = document.createElement('span');
    metric.textContent = `${Number(value).toLocaleString(currentLanguage)} ${label.toLocaleLowerCase(currentLanguage)}`;
    metrics.append(metric);
  });

  const disclosure = document.createElement('details');
  disclosure.className = 'report-disclosure';
  const disclosureLabel = document.createElement('summary');
  disclosureLabel.textContent = translate('viewDetails');
  const details = document.createElement('div');
  details.className = 'report-details';
  appendReportField(details, translate('summary'), report.summary);
  appendReportField(details, translate('mainObjectives'), report.mainObjectives);
  appendReportField(details, translate('activities'), report.activities);
  appendReportField(details, translate('achievements'), report.achievements);
  appendReportField(details, translate('challenges'), report.challenges);
  appendReportField(details, translate('solutions'), report.solutions);
  appendReportField(details, translate('referrals'), report.referrals);
  appendReportField(details, translate('recommendations'), report.recommendations);
  appendReportField(details, translate('nextMonthPlan'), report.nextMonthPlan);
  appendReportField(details, translate('remarks'), report.remarks);
  disclosure.append(disclosureLabel, details);
  card.append(heading, metadata, metrics, disclosure);

  if (report.reviewComment) {
    const comment = document.createElement('p');
    comment.className = 'review-comment';
    comment.textContent = `${translate('reviewFeedback')}: ${report.reviewComment}`;
    card.append(comment);
  }

  const actions = document.createElement('div');
  actions.className = 'report-card-actions';
  const periodIsOpen = openPeriods().some((period) => period.id === report.reportingPeriodId);
  if (currentUser.role === 'member' && Number(report.authorId) === Number(currentUser.id)
    && periodIsOpen && ['draft', 'returned'].includes(report.status)) {
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'quiet-button';
    edit.dataset.action = 'edit';
    edit.textContent = translate('editReport');
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'primary-button compact-button';
    submit.dataset.action = 'submit';
    submit.textContent = translate('submitReport');
    actions.append(edit, submit);
  }
  const reviewActions = {
    department_head: {
      submitted: { endpoint: 'department-review', actions: ['department_forward', 'department_return'] }
    },
    secretary: {
      secretary_review: { endpoint: 'secretary-review', actions: ['secretary_forward', 'secretary_return'] }
    },
    vice_chairperson: {
      vice_review: { endpoint: 'vice-review', actions: ['vice_forward', 'vice_return', 'vice_reject'] }
    },
    chairperson: {
      chair_review: { endpoint: 'chair-review', actions: ['chair_approve', 'chair_return', 'chair_reject'] }
    }
  };
  const review = reviewActions[currentUser.role]?.[report.status];
  if (review) {
    const comment = document.createElement('textarea');
    comment.className = 'review-input';
    comment.maxLength = 4000;
    comment.rows = 2;
    comment.placeholder = translate('reviewCommentPlaceholder');
    comment.setAttribute('aria-label', translate('reviewCommentPlaceholder'));
    actions.append(comment);
    review.actions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.endsWith('_forward') || action === 'chair_approve'
        ? 'primary-button compact-button' : 'quiet-button';
      button.dataset.action = action;
      button.dataset.endpoint = review.endpoint;
      button.textContent = translate(action);
      actions.append(button);
    });
  }
  const historyButton = document.createElement('button');
  historyButton.type = 'button';
  historyButton.className = 'quiet-button';
  historyButton.dataset.action = 'history';
  historyButton.textContent = translate('reportHistory');
  actions.append(historyButton);
  if (actions.childElementCount) card.append(actions);
  const history = document.createElement('div');
  history.className = 'report-history';
  history.hidden = true;
  card.append(history);
  return card;
}

function filterReports(reports) {
  const query = document.querySelector('#report-search').value.trim().toLocaleLowerCase(currentLanguage);
  const status = document.querySelector('#report-status').value;
  return reports.filter((report) => {
    if (status !== 'all' && report.status !== status) return false;
    if (!query) return true;
    const searchText = [
      report.departmentName,
      report.submittedBy,
      report.summary,
      report.activities,
      report.achievements,
      report.challenges,
      report.nextMonthPlan,
      report.reviewComment,
      reportPeriodLabel({ month: report.periodMonth, year: report.periodYear })
    ].join(' ').toLocaleLowerCase(currentLanguage);
    return searchText.includes(query);
  });
}

function renderReports() {
  if (!currentUser || !reportList) return;
  const isAdmin = currentUser.role === 'admin';
  const isMember = currentUser.role === 'member';
  document.querySelectorAll('[data-nav-role="admin"]').forEach((link) => {
    link.hidden = !isAdmin;
  });
  document.querySelector('#sidebar-report-count').textContent = String(reportData.reports.length);
  document.querySelector('#reporting-intro').textContent = translate(
    {
      admin: 'viewReportsHint',
      member: 'memberReportsHint',
      department_head: 'headReportsHint',
      secretary: 'secretaryReportsHint',
      vice_chairperson: 'viceReportsHint',
      chairperson: 'chairReportsHint'
    }[currentUser.role] || 'viewReportsHint'
  );
  document.querySelector('#new-report').hidden = !isMember
    || !DashboardMetrics.getAvailableReportPeriods(
      currentUser,
      reportData.reports,
      openPeriods(),
      reportData.departments
    ).length;
  document.querySelector('[data-dashboard-target="new-report"]').hidden = document.querySelector('#new-report').hidden;
  document.querySelector('[data-dashboard-page="periods"]').hidden = !isAdmin;
  document.querySelector('[data-dashboard-page="organization"]').hidden = !isAdmin;
  periodForm.hidden = !isAdmin;
  document.querySelector('#admin-workspace').hidden = !isAdmin;
  document.querySelector('#export-reports').hidden = ![
    'admin', 'chairperson', 'vice_chairperson', 'secretary', 'department_head'
  ].includes(currentUser.role);
  reportList.replaceChildren();

  const periods = document.querySelector('#period-month');
  if (!periods.options.length) {
    for (let month = 1; month <= 12; month += 1) {
      appendOption(periods, month, translate(`month_${month}`));
    }
  } else {
    Array.from(periods.options).forEach((option, index) => {
      option.textContent = translate(`month_${index + 1}`);
    });
  }

  if (isAdmin && !document.querySelector('#period-year').value) {
    document.querySelector('#period-year').value = new Date().getFullYear();
  }

  const reports = reportData.reports;
  const visibleReports = filterReports(reports);
  renderDashboardStats(reports);
  renderPeriods();
  document.querySelector('#report-result-count').textContent = translate('reportCount')
    .replace('{count}', visibleReports.length)
    .replace('{total}', reports.length);
  if (!visibleReports.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const mark = document.createElement('span');
    mark.className = 'empty-mark';
    mark.setAttribute('aria-hidden', 'true');
    ['1', '2', '3'].forEach((height) => {
      const bar = document.createElement('span');
      bar.dataset.height = height;
      mark.append(bar);
    });
    const title = document.createElement('h2');
    const hasFilters = reports.length > 0;
    title.textContent = translate(hasFilters ? 'noMatchingReports' : 'noReports');
    const hint = document.createElement('p');
    hint.textContent = translate(hasFilters ? 'adjustFilters' : 'noReportsHint');
    empty.append(mark, title, hint);
    reportList.append(empty);
    return;
  }
  visibleReports.forEach((report) => reportList.append(createReportCard(report)));
}

function renderDashboardStats(reports) {
  const stats = document.querySelector('#dashboard-stats');
  stats.replaceChildren();
  const metrics = DashboardMetrics.getDashboardMetrics(currentUser, reports, adminData, reportData.periods);
  stats.classList.toggle('dashboard-stats-compact', metrics.length < 4);
  metrics.forEach(([key, value]) => {
    const card = document.createElement('article');
    card.className = 'stat-card';
    const number = document.createElement('strong');
    number.textContent = Number(value).toLocaleString(currentLanguage);
    const caption = document.createElement('span');
    caption.textContent = translate(key);
    card.append(number, caption);
    stats.append(card);
  });
}

function renderPeriods() {
  const list = document.querySelector('#period-list');
  list.replaceChildren();
  if (!reportData.periods.length) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = translate('noPeriods');
    list.append(empty);
    return;
  }
  reportData.periods.forEach((period) => {
    const row = document.createElement('div');
    row.className = 'period-row';
    const description = document.createElement('div');
    description.className = 'period-row-description';
    const label = document.createElement('strong');
    label.textContent = reportPeriodLabel(period);
    const dates = document.createElement('span');
    dates.textContent = `${period.opensAt} – ${period.closesAt}`;
    description.append(label, dates);
    const status = document.createElement('span');
    status.className = `period-status${period.isClosed ? ' period-status-closed' : period.isOpen ? ' period-status-open' : ' period-status-upcoming'}`;
    status.textContent = period.isClosed ? translate('closed') : period.isOpen ? translate('open') : translate('outsideDates');
    row.append(description, status);
    if (!period.isClosed) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'quiet-button';
      close.dataset.closePeriod = period.id;
      close.textContent = translate('closePeriod');
      row.append(close);
    }
    list.append(row);
  });
}

function renderAdmin() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const setupItems = document.querySelector('#setup-checklist-items');
  setupItems.replaceChildren();
  const activeUsers = adminData.users.filter((user) => user.isActive);
  const departmentMembers = adminData.departments
    .filter((department) => department.isActive)
    .flatMap((department) => department.members.map((member) => ({ ...member, departmentId: department.id })));
  const activeUserIds = new Set(activeUsers.map((user) => Number(user.id)));
  const checkItems = [
    ...['admin', 'chairperson', 'vice_chairperson', 'secretary', 'department_head', 'member'].map((role) => ({
      label: translate('setupRoleAccount').replace('{role}', translate(`role_${role}`)),
      complete: activeUsers.some((user) => user.role === role)
    })),
    {
      label: translate('setupDepartment'),
      complete: adminData.departments.some((department) => department.isActive)
    },
    {
      label: translate('setupHeadAssignment'),
      complete: departmentMembers.some((member) => member.membershipRole === 'head'
        && activeUserIds.has(Number(member.userId))
        && activeUsers.some((user) => Number(user.id) === Number(member.userId) && user.role === 'department_head'))
    },
    {
      label: translate('setupMemberAssignment'),
      complete: departmentMembers.some((member) => member.membershipRole === 'member'
        && activeUserIds.has(Number(member.userId))
        && activeUsers.some((user) => Number(user.id) === Number(member.userId) && user.role === 'member'))
    },
    {
      label: translate('setupPeriod'),
      complete: reportData.periods.some((period) => period.isOpen)
    }
  ];
  const completeItems = checkItems.filter((item) => item.complete).length;
  document.querySelector('#setup-checklist-summary').textContent = translate(
    completeItems === checkItems.length ? 'setupComplete' : 'setupProgress'
  ).replace('{complete}', String(completeItems)).replace('{total}', String(checkItems.length));
  checkItems.forEach((item) => {
    const row = document.createElement('li');
    row.className = item.complete ? 'setup-check-complete' : 'setup-check-pending';
    const status = document.createElement('span');
    status.setAttribute('aria-hidden', 'true');
    status.textContent = item.complete ? '✓' : '!';
    const label = document.createElement('span');
    label.textContent = item.label;
    const state = document.createElement('strong');
    state.textContent = translate(item.complete ? 'setupDone' : 'setupNeeded');
    row.append(status, label, state);
    setupItems.append(row);
  });

  const roles = document.querySelector('#user-role');
  const selectedRole = roles.value || 'member';
  roles.replaceChildren();
  adminData.roles.forEach((role) => appendOption(roles, role, translate(`role_${role}`)));
  roles.value = selectedRole;

  const roleFilter = document.querySelector('#user-role-filter');
  const selectedFilterRole = roleFilter.value || 'all';
  roleFilter.replaceChildren();
  appendOption(roleFilter, 'all', translate('allRoles'));
  adminData.roles.forEach((role) => appendOption(roleFilter, role, translate(`role_${role}`)));
  roleFilter.value = selectedFilterRole;

  const departmentSelect = document.querySelector('#assignment-department');
  const userSelect = document.querySelector('#assignment-user');
  departmentSelect.replaceChildren();
  userSelect.replaceChildren();
  adminData.departments.filter((department) => department.isActive)
    .forEach((department) => appendOption(departmentSelect, department.id, department.name));
  adminData.users.filter((user) => user.isActive)
    .forEach((user) => appendOption(userSelect, user.id, `${user.displayName} (${translate(`role_${user.role}`)})`));

  const userList = document.querySelector('#user-list');
  userList.replaceChildren();
  const search = document.querySelector('#user-search').value.trim().toLocaleLowerCase(currentLanguage);
  const statusFilter = document.querySelector('#user-status-filter').value;
  const roleFilterValue = roleFilter.value;
  const visibleUsers = adminData.users.filter((user) => {
    if (statusFilter === 'active' && !user.isActive) return false;
    if (statusFilter === 'inactive' && user.isActive) return false;
    if (roleFilterValue !== 'all' && user.role !== roleFilterValue) return false;
    return `${user.displayName} ${user.email}`.toLocaleLowerCase(currentLanguage).includes(search);
  });
  document.querySelector('#user-list-count').textContent = translate('accountCount')
    .replace('{count}', String(visibleUsers.length))
    .replace('{total}', String(adminData.users.length));
  if (!visibleUsers.length) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = adminData.users.length ? translate('noMatchingAccounts') : translate('noAccounts');
    userList.append(empty);
  }
  visibleUsers.forEach((user) => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = user.displayName;
    const email = document.createElement('span');
    email.textContent = user.email;
    const status = document.createElement('span');
    status.className = `account-status${user.isActive ? ' account-status-active' : ' account-status-inactive'}`;
    status.textContent = translate(user.isActive ? 'active' : 'inactive');
    info.append(name, email, status);
    const role = document.createElement('select');
    role.setAttribute('aria-label', `${translate('role')} - ${user.displayName}`);
    adminData.roles.forEach((item) => appendOption(role, item, translate(`role_${item}`)));
    role.value = user.role;
    role.dataset.userRole = user.id;
    role.disabled = user.id === currentUser.id;
    const state = document.createElement('button');
    state.type = 'button';
    state.className = 'quiet-button';
    state.dataset.userActive = user.id;
    state.textContent = user.isActive ? translate('deactivate') : translate('activate');
    state.disabled = user.id === currentUser.id;
    row.append(info, role, state);
    userList.append(row);
  });

  const departmentList = document.querySelector('#department-list');
  departmentList.replaceChildren();
  if (!adminData.departments.length) {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = translate('noDepartments');
    departmentList.append(empty);
  }
  adminData.departments.forEach((department) => {
    const section = document.createElement('article');
    section.className = 'department-card';
    const header = document.createElement('div');
    header.className = 'admin-row';
    const title = document.createElement('strong');
    title.textContent = department.name;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'quiet-button';
    toggle.dataset.departmentActive = department.id;
    toggle.textContent = department.isActive ? translate('deactivate') : translate('activate');
    header.append(title, toggle);
    section.append(header);
    department.members.forEach((departmentMember) => {
      const member = document.createElement('div');
      member.className = 'department-member';
      const memberLabel = document.createElement('span');
      memberLabel.textContent = `${departmentMember.userName} · ${translate(`membership_${departmentMember.membershipRole}`)}`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'quiet-button';
      remove.dataset.removeMember = `${department.id}:${departmentMember.userId}`;
      remove.textContent = translate('remove');
      member.append(memberLabel, remove);
      section.append(member);
    });
    departmentList.append(section);
  });
}

async function loadReports() {
  const workspace = document.querySelector('#reports-page');
  workspace.setAttribute('aria-busy', 'true');
  try {
    const limit = 100;
    let offset = 0;
    let page;
    const reports = [];
    do {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      page = await requestJson(`/api/reports?${params}`);
      reports.push(...page.reports);
      offset += page.pagination.limit;
    } while (page.pagination.hasMore);
    reportData = { ...page, reports };
    renderReports();
    if (currentUser.role === 'admin') {
      adminData = await requestJson('/api/admin');
      renderAdmin();
      renderDashboardStats(reportData.reports);
    }
    await loadNotifications();
  } finally {
    workspace.removeAttribute('aria-busy');
  }
}

function setReportForm(report = null) {
  const error = document.querySelector('#report-error');
  error.hidden = true;
  if (!report && !populateReportFormOptions()) {
    showGlobalMessage('noOpenPeriod');
    return;
  }
  setDashboardPage('reports');
  editingReportId = report?.id || null;
  reportForm.reset();
  if (report) {
    populateReportFormOptions(report.reportingPeriodId, report.departmentId);
    document.querySelector('#report-period').replaceChildren();
    appendOption(
      document.querySelector('#report-period'),
      report.reportingPeriodId,
      reportPeriodLabel({ month: report.periodMonth, year: report.periodYear })
    );
    document.querySelector('#report-department').replaceChildren();
    appendOption(document.querySelector('#report-department'), report.departmentId, report.departmentName);
    document.querySelector('#report-title').value = report.title || '';
    document.querySelector('#report-objectives').value = report.mainObjectives || '';
    document.querySelector('#report-summary').value = report.summary || '';
    document.querySelector('#report-activities').value = report.activities || '';
    document.querySelector('#report-achievements').value = report.achievements || '';
    document.querySelector('#report-challenges').value = report.challenges || '';
    document.querySelector('#report-solutions').value = report.solutions || '';
    document.querySelector('#report-referrals').value = report.referrals || '';
    document.querySelector('#report-recommendations').value = report.recommendations || '';
    document.querySelector('#report-plan').value = report.nextMonthPlan || '';
    document.querySelector('#report-remarks').value = report.remarks || '';
    document.querySelector('#report-beneficiaries').value = report.beneficiariesReached;
    document.querySelector('#report-sessions').value = report.sessionsHeld;
    document.querySelector('#report-individual-sessions').value = report.individualSessions;
    document.querySelector('#report-group-sessions').value = report.groupSessions;
    document.querySelector('#report-outreach').value = report.outreachActivities;
  }
  document.querySelector('#report-period').disabled = Boolean(report);
  document.querySelector('#report-department').disabled = Boolean(report);
  document.querySelector('#report-form-title').textContent = translate(report ? 'editReport' : 'newReport');
  const periodIsOpen = !report || openPeriods().some((period) => period.id === report.reportingPeriodId);
  document.querySelector('#save-report').hidden = !periodIsOpen;
  document.querySelector('#submit-report').hidden = !periodIsOpen;
  reportForm.hidden = false;
  reportForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function reportPayload() {
  const formData = new FormData(reportForm);
  return {
    periodId: Number(document.querySelector('#report-period').value),
    departmentId: Number(document.querySelector('#report-department').value),
    title: formData.get('title'),
    mainObjectives: formData.get('mainObjectives'),
    summary: formData.get('summary'),
    activities: formData.get('activities'),
    achievements: formData.get('achievements'),
    challenges: formData.get('challenges'),
    solutions: formData.get('solutions'),
    referrals: formData.get('referrals'),
    recommendations: formData.get('recommendations'),
    nextMonthPlan: formData.get('nextMonthPlan'),
    remarks: formData.get('remarks'),
    beneficiariesReached: Number(formData.get('beneficiariesReached')),
    sessionsHeld: Number(formData.get('sessionsHeld')),
    individualSessions: Number(formData.get('individualSessions')),
    groupSessions: Number(formData.get('groupSessions')),
    outreachActivities: Number(formData.get('outreachActivities'))
  };
}

async function saveReport() {
  const url = editingReportId ? `/api/reports/${editingReportId}` : '/api/reports';
  const method = editingReportId ? 'PUT' : 'POST';
  const result = await requestJson(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reportPayload())
  });
  editingReportId = result.id;
  return result.id;
}

async function initialize() {
  try {
    await setLanguage(currentLanguage, false);
    const response = await fetch('/api/auth/me');
    if (response.status === 401) {
      showView('login');
      return;
    }
    if (!response.ok) throw new Error('internal_server_error');
    const result = await response.json();
    currentUser = result.user;
    setAccountTheme(currentUser);
    await setLanguage(currentUser.language, false);
    setDashboardPage(window.location.hash.slice(1) || 'overview');
    showView('dashboard');
    await loadReports();
  } catch (error) {
    if (currentUser && !dashboardView.hidden) {
      showGlobalMessage(`error_${error.message === 'Failed to fetch' ? 'network' : error.message}`);
    } else {
      showView('login');
      showLoginError(error.message === 'Failed to fetch' ? 'network' : 'internal_server_error');
    }
  }
}

languageSelect.addEventListener('change', () => {
  setLanguage(languageSelect.value);
});

document.querySelector('#report-search').addEventListener('input', renderReports);
document.querySelector('#report-status').addEventListener('change', renderReports);
document.querySelector('.sidebar nav').addEventListener('click', (event) => {
  const link = event.target.closest('[data-dashboard-page]');
  if (!link) return;
  event.preventDefault();
  setDashboardPage(link.dataset.dashboardPage);
});

document.querySelector('.quick-access-grid').addEventListener('click', (event) => {
  const link = event.target.closest('[data-dashboard-page]');
  if (!link || link.hidden) return;
  event.preventDefault();
  setDashboardPage(link.dataset.dashboardPage);
  const target = link.dataset.dashboardTarget;
  if (target === 'new-report') {
    setReportForm();
    return;
  }
  if (target) {
    const element = document.getElementById(target);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    element?.querySelector('input, select, textarea')?.focus({ preventScroll: true });
  }
});

document.querySelector('#user-search').addEventListener('input', renderAdmin);
document.querySelector('#user-role-filter').addEventListener('change', renderAdmin);
document.querySelector('#user-status-filter').addEventListener('change', renderAdmin);

document.querySelector('#notifications-toggle').addEventListener('click', async () => {
  const panel = document.querySelector('#notifications-panel');
  const willOpen = panel.hidden;
  panel.hidden = !willOpen;
  document.querySelector('#notifications-toggle').setAttribute('aria-expanded', String(willOpen));
  if (willOpen) await loadNotifications();
});

document.querySelector('#notification-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-notification-read]');
  if (!button) return;
  button.disabled = true;
  try {
    await requestJson(`/api/notifications/${button.dataset.notificationRead}/read`, { method: 'PATCH' });
    await loadNotifications();
  } catch (error) {
    showGlobalMessage(`error_${error.message}`);
    button.disabled = false;
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const button = document.querySelector('#login-button');
  button.disabled = true;
  button.querySelector('span').textContent = translations[currentLanguage].loading;
  const formData = new FormData(loginForm);
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') })
    });
    const result = await response.json();
    if (!response.ok) {
      showLoginError(result.error || 'internal_server_error');
      return;
    }
    currentUser = result.user;
    setAccountTheme(currentUser);
    await setLanguage(currentUser.language, false);
    setDashboardPage('overview');
    loginForm.reset();
    showView('dashboard');
    await loadReports();
  } catch (error) {
    if (currentUser && !dashboardView.hidden) {
      showGlobalMessage(`error_${error.message === 'Failed to fetch' ? 'network' : error.message}`);
    } else {
      showLoginError(error.message === 'Failed to fetch' ? 'network' : 'internal_server_error');
    }
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = translations[currentLanguage].signIn;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
    clearSignedInState();
  } catch (error) {
    showGlobalMessage(`error_${error.message}`);
  }
});

document.querySelector('#change-password-open').addEventListener('click', () => {
  passwordChangeError.hidden = true;
  passwordForm.reset();
  passwordDialog.showModal();
  document.querySelector('#current-password').focus();
});

function closePasswordDialog() {
  passwordDialog.close();
  passwordForm.reset();
  passwordChangeError.hidden = true;
}

document.querySelector('#close-password-dialog').addEventListener('click', closePasswordDialog);
document.querySelector('#cancel-password-change').addEventListener('click', closePasswordDialog);
passwordDialog.addEventListener('click', (event) => {
  if (event.target === passwordDialog) closePasswordDialog();
});

passwordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  passwordChangeError.hidden = true;
  const formData = new FormData(passwordForm);
  const newPassword = formData.get('newPassword');
  if (newPassword !== formData.get('confirmPassword')) {
    passwordChangeError.textContent = translate('passwordConfirmationMismatch');
    passwordChangeError.hidden = false;
    return;
  }
  const button = document.querySelector('#save-password');
  button.disabled = true;
  try {
    await requestJson('/api/auth/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: formData.get('currentPassword'),
        newPassword
      })
    });
    closePasswordDialog();
    clearSignedInState();
    showGlobalMessage('passwordChangedSignInAgain');
  } catch (error) {
    showRequestError(passwordChangeError, error);
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#new-report').addEventListener('click', () => setReportForm());
document.querySelector('#cancel-report').addEventListener('click', () => {
  reportForm.hidden = true;
  editingReportId = null;
});

document.querySelector('#report-period').addEventListener('change', () => {
  populateReportFormOptions(Number(document.querySelector('#report-period').value));
});

reportForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('#report-error');
  const button = event.submitter;
  error.hidden = true;
  if (button) button.disabled = true;
  try {
    await saveReport();
    reportForm.hidden = true;
    await loadReports();
    showGlobalMessage('draftSaved');
  } catch (requestError) {
    showRequestError(error, requestError);
  } finally {
    if (button) button.disabled = false;
  }
});

document.querySelector('#submit-report').addEventListener('click', async () => {
  const error = document.querySelector('#report-error');
  error.hidden = true;
  const button = document.querySelector('#submit-report');
  button.disabled = true;
  try {
    const reportId = await saveReport();
    await requestJson(`/api/reports/${reportId}/submit`, { method: 'POST' });
    editingReportId = null;
    reportForm.hidden = true;
    await loadReports();
    showGlobalMessage('reportSubmitted');
  } catch (requestError) {
    showRequestError(error, requestError);
  } finally {
    button.disabled = false;
  }
});

reportList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('.report-card');
  const report = reportData.reports.find((item) => String(item.id) === card.dataset.reportId);
  if (!report) return;
  if (button.dataset.action === 'history') {
    const history = card.querySelector('.report-history');
    if (!history.hidden) {
      history.hidden = true;
      return;
    }
    if (!history.dataset.loaded) {
      try {
        const result = await requestJson(`/api/reports/${report.id}/history`);
        renderReportHistory(history, result);
        history.dataset.loaded = 'true';
      } catch (requestError) {
        showGlobalMessage(`error_${requestError.message}`);
        return;
      }
    }
    history.hidden = false;
    return;
  }
  if (button.dataset.action === 'edit') {
    setReportForm(report);
    return;
  }
  const error = document.querySelector('#report-error');
  try {
    if (button.dataset.action === 'submit') {
      await requestJson(`/api/reports/${report.id}/submit`, { method: 'POST' });
      showGlobalMessage('reportSubmitted');
    } else {
      const comment = card.querySelector('.review-input').value;
      const action = button.dataset.action;
      const result = await requestJson(`/api/reports/${report.id}/${button.dataset.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment })
      });
      showGlobalMessage(action === 'chair_approve' ? 'reportApproved'
        : action.endsWith('_forward') ? 'reportForwarded'
          : action.endsWith('_reject') ? 'reportRejected' : 'reportReturned');
    }
    await loadReports();
  } catch (requestError) {
    showRequestError(error, requestError);
    error.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

periodForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('#period-error');
  const button = event.submitter;
  error.hidden = true;
  if (button) button.disabled = true;
  const formData = new FormData(periodForm);
  try {
    const openDate = new Date(`${formData.get('opensAt')}T00:00:00`);
    const closeDate = new Date(`${formData.get('closesAt')}T00:00:00`);
    if (closeDate < openDate) {
      throw new Error('invalid_reporting_dates');
    }
    await requestJson('/api/reports/periods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: Number(formData.get('year')),
        month: Number(formData.get('month')),
        opensAt: formData.get('opensAt'),
        closesAt: formData.get('closesAt')
      })
    });
    periodForm.reset();
    await loadReports();
    showGlobalMessage('periodCreated');
  } catch (requestError) {
    showRequestError(error, requestError);
  } finally {
    if (button) button.disabled = false;
  }
});

document.querySelector('#period-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-close-period]');
  if (!button) return;
  if (!window.confirm(translate('confirmClosePeriod'))) return;
  button.disabled = true;
  try {
    await requestJson(`/api/reports/periods/${button.dataset.closePeriod}/close`, { method: 'POST' });
    await loadReports();
    showGlobalMessage('periodClosed');
  } catch (error) {
    showGlobalMessage(`error_${error.message}`);
    button.disabled = false;
  }
});

document.querySelector('#user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('#user-error');
  error.hidden = true;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await requestJson('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    });
    event.currentTarget.reset();
    await loadReports();
    showGlobalMessage('accountCreated');
  } catch (requestError) {
    showRequestError(error, requestError);
  }
});

document.querySelector('#department-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('#department-error');
  error.hidden = true;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await requestJson('/api/admin/departments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values)
    });
    event.currentTarget.reset();
    await loadReports();
    showGlobalMessage('departmentCreated');
  } catch (requestError) {
    showRequestError(error, requestError);
  }
});

document.querySelector('#assignment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.querySelector('#assignment-error');
  error.hidden = true;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await requestJson(`/api/admin/departments/${values.departmentId}/members/${values.userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ membershipRole: values.membershipRole })
    });
    await loadReports();
    showGlobalMessage('memberAssigned');
  } catch (requestError) {
    showRequestError(error, requestError);
  }
});

document.querySelector('#user-list').addEventListener('change', async (event) => {
  const select = event.target.closest('[data-user-role]');
  if (!select) return;
  try {
    await requestJson(`/api/admin/users/${select.dataset.userRole}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: select.value })
    });
    await loadReports();
    showGlobalMessage('accountUpdated');
  } catch (error) {
    showGlobalMessage(`error_${error.message}`);
    await loadReports();
  }
});

document.querySelector('#user-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-user-active]');
  if (!button) return;
  const user = adminData.users.find((item) => String(item.id) === button.dataset.userActive);
  if (!user) return;
  if (!window.confirm(translate(user.isActive ? 'confirmDeactivateAccount' : 'confirmActivateAccount'))) return;
  button.disabled = true;
  try {
    await requestJson(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !user.isActive })
    });
    await loadReports();
    showGlobalMessage('accountUpdated');
  } catch (error) {
    showGlobalMessage(`error_${error.message}`);
    button.disabled = false;
  }
});

document.querySelector('#department-list').addEventListener('click', async (event) => {
  const toggle = event.target.closest('[data-department-active]');
  const remove = event.target.closest('[data-remove-member]');
  try {
    if (toggle) {
      const department = adminData.departments.find((item) => String(item.id) === toggle.dataset.departmentActive);
      if (!department) return;
      if (!window.confirm(translate(department.isActive ? 'confirmDeactivateDepartment' : 'confirmActivateDepartment'))) return;
      toggle.disabled = true;
      await requestJson(`/api/admin/departments/${department.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !department.isActive })
      });
    } else if (remove) {
      if (!window.confirm(translate('confirmRemoveMember'))) return;
      remove.disabled = true;
      const [departmentId, userId] = remove.dataset.removeMember.split(':');
      await requestJson(`/api/admin/departments/${departmentId}/members/${userId}`, { method: 'DELETE' });
    } else {
      return;
    }
    await loadReports();
    showGlobalMessage(toggle ? 'departmentUpdated' : 'memberRemoved');
  } catch (error) {
    showGlobalMessage(`error_${error.message}`);
    if (toggle) toggle.disabled = false;
    if (remove) remove.disabled = false;
  }
});

initialize().catch(() => showView('login'));
