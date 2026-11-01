import { appendFileSync } from 'node:fs';

// Observation only: do not mutate the task, assertion, error, or test outcome.
export default class FailureDetailReporter {
  onTestCaseResult(testCase) {
    const result = testCase.result();
    if (result.state !== 'failed') return;
    const destination = process.env.WILLYOU_TEST_FAILURE_DETAILS;
    if (!destination) throw new Error('Private failure detail destination is missing');
    const seen = new WeakSet();
    const record = {
      at: new Date().toISOString(),
      id: testCase.id,
      name: testCase.fullName,
      location: testCase.location,
      file: testCase.module.moduleId,
      errors: result.errors.map(error => ({
        name: error.name,
        message: error.message,
        stack: error.stack,
        actualCaptured: Object.hasOwn(error, 'actual'),
        actual: error.actual,
        expectedCaptured: Object.hasOwn(error, 'expected'),
        expected: error.expected,
        diff: error.diff,
        code: error.code,
      })),
    };
    const bytes = JSON.stringify(record, (_key, value) => {
      if (typeof value === 'bigint') return String(value);
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
      }
      return value;
    });
    appendFileSync(destination, bytes + '\n');
  }
}
