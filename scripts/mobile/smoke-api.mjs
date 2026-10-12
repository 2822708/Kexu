#!/usr/bin/env node
// Writes only two fresh test workspaces on the dedicated isolated loopback server.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:17827');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)
    || base.port !== '17827' || base.pathname !== '/' || base.username || base.password) {
  throw new Error('This destructive smoke test accepts only the isolated http://127.0.0.1:17827 server.');
}
const output = resolve(process.argv[3] ?? 'work/mobile-api-smoke.json');
const first = `device_${randomBytes(32).toString('base64url')}`;
const second = `device_${randomBytes(32).toString('base64url')}`;
const marker = `Mobile smoke ${Date.now()}`;
const checks = [];
const ownedSchedules = new Set();
const ownedTodos = new Set();
const isoDate = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const termStart = isoDate(0);
const termEnd = isoDate(120);
const examDate = isoDate(14);

async function request(method, path, key, body, expected = 200) {
  const headers = {};
  if (key) headers['X-API-Key'] = key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(`/api${path}`, base), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${payload.message ?? response.status}`);
  assert.equal(payload.code, expected, `${method} ${path}: unexpected API code`);
  return payload.data;
}

function check(name, condition) {
  assert.ok(condition, name);
  checks.push(name);
  console.log(`PASS ${name}`);
}

let failure;
try {
  await request('GET', '/schedules', undefined, undefined, 401);
  check('Missing X-API-Key is rejected', true);
  const identity = await request('POST', '/auth/device', undefined, { deviceKey: first });
  check('A browser device registers as USER', identity.valid && identity.role === 'USER');
  await request('POST', '/auth/device', undefined, { deviceKey: second });
  const reconnect = await request('POST', '/auth/device', undefined, { deviceKey: first });
  check('Device reconnect is idempotent', reconnect.valid && reconnect.role === 'USER');
  check('Device verifies through X-API-Key', (await request('GET', '/auth/verify', first)).valid);
  check('Fresh workspace has no schedules', (await request('GET', '/schedules', first)).length === 0);
  check('AI is disabled without a provider credential', (await request('GET', '/ai/status', first)).enabled === false);

  const scheduleBody = { name: marker, periodStartDate: termStart, periodEndDate: termEnd };
  const schedule = await request('POST', '/schedules', first, scheduleBody);
  ownedSchedules.add(schedule.id);
  check('Schedule create/read', (await request('GET', `/schedules/${schedule.id}`, first)).schedule.name === marker);
  const renamed = await request('PUT', `/schedules/${schedule.id}`, first, { ...scheduleBody, name: `${marker} updated` });
  check('Schedule update', renamed.name.endsWith(' updated'));
  check('Another account cannot list the schedule', (await request('GET', '/schedules', second)).length === 0);
  await request('GET', `/schedules/${schedule.id}`, second, undefined, 404);
  await request('PUT', `/schedules/${schedule.id}`, second, scheduleBody, 404);
  await request('DELETE', `/schedules/${schedule.id}`, second, undefined, 404);
  check('Schedule ownership blocks cross-account read/update/delete', true);

  const courseBody = { name: `${marker} course`, location: 'Test room', teacher: 'Test teacher',
    dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3] };
  const course = await request('POST', `/schedules/${schedule.id}/courses`, first, courseBody);
  check('Course create/read', (await request('GET', `/schedules/${schedule.id}/courses`, first)).some((item) => item.id === course.id));
  const editedCourse = await request('PUT', `/courses/${course.id}`, first, { ...courseBody, location: 'Updated room' });
  check('Course update', editedCourse.location === 'Updated room');
  await request('PUT', `/courses/${course.id}`, second, courseBody, 404);
  await request('DELETE', `/courses/${course.id}`, second, undefined, 404);
  await request('GET', `/schedules/${schedule.id}/courses`, second, undefined, 404);
  check('Course ownership blocks cross-account access', true);

  const todoBody = { title: `${marker} todo`, ddl: `${examDate}T18:00:00` };
  const todo = await request('POST', '/todos', first, todoBody);
  ownedTodos.add(todo.id);
  check('Todo create/read', (await request('GET', '/todos', first)).some((item) => item.id === todo.id));
  const editedTodo = await request('PUT', `/todos/${todo.id}`, first, { ...todoBody, title: `${marker} edited todo` });
  check('Todo update', editedTodo.title.endsWith(' edited todo'));
  check('Todo completion toggle', (await request('PUT', `/todos/${todo.id}/toggle`, first)).completed === true);
  check('Another account has no first-account todos', (await request('GET', '/todos', second)).length === 0);
  await request('PUT', `/todos/${todo.id}`, second, todoBody, 404);
  await request('PUT', `/todos/${todo.id}/toggle`, second, undefined, 404);
  await request('DELETE', `/todos/${todo.id}`, second, undefined, 404);
  check('Todo ownership blocks cross-account mutations', true);

  const examBody = { name: `${marker} exam`, location: 'Test exam room', examDate,
    startTime: '09:00:00', endTime: '10:00:00' };
  const exam = await request('POST', `/schedules/${schedule.id}/exams`, first, examBody);
  check('Exam create/read', (await request('GET', `/schedules/${schedule.id}/exams`, first)).some((item) => item.id === exam.id));
  let linked = (await request('GET', '/todos', first)).filter((item) => item.examId === exam.id);
  check('Exam creates exactly one linked todo', linked.length === 1 && linked[0].title === examBody.name);
  check('Linked todo deadline equals exam start', linked[0].ddl.startsWith(`${examDate}T09:00`));
  const updatedExamBody = { ...examBody, name: `${marker} updated exam`, startTime: '10:00:00', endTime: '11:00:00' };
  const editedExam = await request('PUT', `/exams/${exam.id}`, first, updatedExamBody);
  check('Exam update', editedExam.name === updatedExamBody.name);
  linked = (await request('GET', '/todos', first)).filter((item) => item.examId === exam.id);
  check('Exam update changes linked title and deadline', linked.length === 1 && linked[0].title === updatedExamBody.name
    && linked[0].ddl.startsWith(`${examDate}T10:00`));
  await request('GET', `/schedules/${schedule.id}/exams`, second, undefined, 404);
  await request('PUT', `/exams/${exam.id}`, second, examBody, 404);
  await request('DELETE', `/exams/${exam.id}`, second, undefined, 404);
  check('Exam ownership blocks cross-account access', true);
  await request('DELETE', `/exams/${exam.id}`, first);
  check('Exam delete', !(await request('GET', `/schedules/${schedule.id}/exams`, first)).some((item) => item.id === exam.id));
  check('Exam deletion removes its linked todo', !(await request('GET', '/todos', first)).some((item) => item.examId === exam.id));

  await request('DELETE', `/courses/${course.id}`, first);
  check('Course delete', (await request('GET', `/schedules/${schedule.id}/courses`, first)).length === 0);
  await request('DELETE', `/todos/${todo.id}`, first);
  ownedTodos.delete(todo.id);
  check('Todo delete', (await request('GET', '/todos', first)).length === 0);
  await request('DELETE', `/schedules/${schedule.id}`, first);
  ownedSchedules.delete(schedule.id);
  check('Schedule delete', (await request('GET', '/schedules', first)).length === 0);
} catch (error) {
  failure = error;
  process.exitCode = 1;
  console.error(`FAIL ${error.message}`);
} finally {
  // Delete only IDs created by this run; never clear tables or reuse user accounts.
  for (const id of ownedSchedules) {
    await request('DELETE', `/schedules/${id}`, first).catch(() => {});
  }
  for (const id of ownedTodos) {
    await request('DELETE', `/todos/${id}`, first).catch(() => {});
  }
  const report = { at: new Date().toISOString(), baseUrl: base.origin,
    status: failure ? 'FAIL' : 'PASS', count: checks.length, checks,
    ...(failure ? { error: failure.message } : {}),
    limits: ['Only isolated H2 HTTP API tested', 'AI provider/SSE not tested', 'No phone or HTTPS deployment tested'] };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${report.status}: ${checks.length} checks; report ${output}`);
}
