const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getAvailableReportDepartments,
  getAvailableReportPeriods,
  getDashboardMetrics
} = require('../assets/js/dashboard-metrics');

const periods = [
  { id: 1, isOpen: true },
  { id: 2, isOpen: false }
];
const departments = [{ id: 10 }, { id: 20 }];

test('a member can create a report for their own department and period only once', () => {
  const user = { id: 5, role: 'member' };
  const reports = [{ reportingPeriodId: 1, departmentId: 10, authorId: 5, status: 'draft' }];

  assert.deepEqual(getAvailableReportPeriods(user, reports, periods, departments), [{ id: 1, isOpen: true }]);
  assert.deepEqual(getAvailableReportDepartments(user, reports, 1, departments), [{ id: 20 }]);
});

test('another member can report for the same department and period', () => {
  const user = { id: 6, role: 'member' };
  const reports = [{ reportingPeriodId: 1, departmentId: 10, authorId: 5, status: 'submitted' }];

  assert.deepEqual(getAvailableReportPeriods(user, reports, periods, departments), [{ id: 1, isOpen: true }]);
  assert.deepEqual(getAvailableReportDepartments(user, reports, 1, departments), departments);
});

test('report availability excludes closed periods and departments already reported by this member', () => {
  const user = { id: 5, role: 'member' };
  const reports = [
    { reportingPeriodId: 1, departmentId: 10, authorId: 5 },
    { reportingPeriodId: 1, departmentId: 20, authorId: 5 },
    { reportingPeriodId: 2, departmentId: 10, authorId: 5 }
  ];

  assert.deepEqual(getAvailableReportPeriods(user, reports, periods, departments), []);
  assert.deepEqual(getAvailableReportDepartments(user, reports, 1, departments), []);
});

test('member dashboard counts only the member own reports and active review statuses', () => {
  const reports = [
    { authorId: 5, status: 'draft' },
    { authorId: 5, status: 'returned' },
    { authorId: 5, status: 'approved' },
    { authorId: 6, status: 'submitted' }
  ];
  assert.deepEqual(
    getDashboardMetrics({ id: 5, role: 'member' }, reports, { users: [], departments: [] }, []),
    [['myReports', 3], ['draftReports', 1], ['reportsInReview', 0], ['returnedReports', 1]]
  );
});

test('reviewer dashboards show only metrics supported by each role visible reports', () => {
  const reports = [
    { status: 'secretary_review' },
    { status: 'chair_review' },
    { status: 'approved' },
    { status: 'rejected' }
  ];
  assert.deepEqual(
    getDashboardMetrics({ role: 'secretary' }, reports, { users: [], departments: [] }, periods),
    [['reportsToReview', 1], ['openReportingPeriods', 1]]
  );
  assert.deepEqual(
    getDashboardMetrics({ role: 'chairperson' }, reports, { users: [], departments: [] }, periods),
    [['reportsToReview', 1], ['approvedReports', 1], ['totalReports', 4]]
  );
});

test('administrator dashboard counts active setup records and pending workflow reports', () => {
  const reports = [
    { status: 'submitted' },
    { status: 'vice_review' },
    { status: 'approved' }
  ];
  const adminData = {
    users: [{ isActive: true }, { isActive: false }, { isActive: true }],
    departments: [{ isActive: true }, { isActive: false }]
  };
  assert.deepEqual(
    getDashboardMetrics({ role: 'admin' }, reports, adminData, periods),
    [
      ['activeAccounts', 2],
      ['activeDepartments', 1],
      ['openReportingPeriods', 1],
      ['awaitingReview', 2]
    ]
  );
});
