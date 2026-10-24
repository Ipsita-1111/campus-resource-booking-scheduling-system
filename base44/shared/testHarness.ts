// ============================================================
// TEST HARNESS SHARED HELPERS
//
// Small utilities reused by the Phase 4/5/6 backend test harnesses so the
// synthetic-user and result-recording logic is not duplicated across
// runConcurrencyTest / runApprovalWorkflowTest / runTimetableConflictTest.
// ============================================================

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function mkStudent(id, name) {
  return { id, campus_role: 'STUDENT', role: 'user', full_name: name, email: id + '@test.local' };
}

export function mkFaculty(id, name) {
  return { id, campus_role: 'FACULTY', role: 'user', full_name: name, email: id + '@test.local' };
}

// Build a result recorder that accumulates per-test pass/fail into a summary.
export function makeRecorder() {
  const results = {};
  const summary = { total: 0, passed: 0, failed: 0 };
  function record(n, pass, detail) {
    results[`TEST_${n}`] = { pass, ...detail };
    summary.total++;
    if (pass) summary.passed++;
    else summary.failed++;
  }
  return { results, summary, record };
}