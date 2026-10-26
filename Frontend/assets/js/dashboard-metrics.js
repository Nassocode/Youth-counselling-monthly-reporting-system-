(function attachDashboardMetrics(root) {
  function hasReportForUser(reports, periodId, departmentId, userId) {
    return reports.some((report) => (
      Number(report.reportingPeriodId) === Number(periodId)
      && Number(report.departmentId) === Number(departmentId)
      && Number(report.authorId) === Number(userId)
    ));
  }

  function getAvailableReportPeriods(user, reports, periods, departments) {
    return periods.filter((period) => period.isOpen && departments.some((department) => (
      !hasReportForUser(reports, period.id, department.id, user.id)
    )));
  }

  function getAvailableReportDepartments(user, reports, periodId, departments) {
    return departments.filter((department) => (
      !hasReportForUser(reports, periodId, department.id, user.id)
    ));
  }

  function getDashboardMetrics(user, reports, adminData, periods) {
    const countStatus = (...statuses) => reports.filter((report) => statuses.includes(report.status)).length;
    const userReports = reports.filter((report) => Number(report.authorId) === Number(user.id));
    const inReview = ['submitted', 'secretary_review', 'vice_review', 'chair_review'];
    const completedOrForwarded = ['secretary_review', 'vice_review', 'chair_review', 'approved'];
    if (user.role === 'admin') {
      return [
        ['activeAccounts', adminData.users.filter((account) => account.isActive).length],
        ['activeDepartments', adminData.departments.filter((department) => department.isActive).length],
        ['openReportingPeriods', periods.filter((period) => period.isOpen).length],
        ['awaitingReview', countStatus(...inReview)]
      ];
    }
    if (user.role === 'member') {
      return [
        ['myReports', userReports.length],
        ['draftReports', userReports.filter((report) => report.status === 'draft').length],
        ['reportsInReview', userReports.filter((report) => inReview.includes(report.status)).length],
        ['returnedReports', userReports.filter((report) => report.status === 'returned').length]
      ];
    }
    if (user.role === 'department_head') {
      return [
        ['reportsToReview', countStatus('submitted')],
        ['returnedReports', countStatus('returned')],
        ['progressedReports', countStatus(...completedOrForwarded)],
        ['totalReports', reports.length]
      ];
    }
    const queueStatus = {
      secretary: 'secretary_review',
      vice_chairperson: 'vice_review',
      chairperson: 'chair_review'
    }[user.role];
    if (!queueStatus) return [['totalReports', reports.length]];
    const metrics = [['reportsToReview', countStatus(queueStatus)]];
    if (user.role === 'chairperson') {
      metrics.push(['approvedReports', countStatus('approved')]);
      metrics.push(['totalReports', reports.length]);
    } else if (periods.length) {
      metrics.push(['openReportingPeriods', periods.filter((period) => period.isOpen).length]);
    }
    return metrics;
  }

  const metrics = {
    hasReportForUser,
    getAvailableReportPeriods,
    getAvailableReportDepartments,
    getDashboardMetrics
  };
  root.DashboardMetrics = metrics;
  if (typeof module !== 'undefined' && module.exports) module.exports = metrics;
}(globalThis));
