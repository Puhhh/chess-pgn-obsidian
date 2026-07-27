import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ALLOWED_ADVISORY = 'GHSA-mh99-v99m-4gvg';
export const ALLOWED_PACKAGE = 'brace-expansion';
export const ALLOWED_VERSIONS = new Set(['1.1.16', '2.1.2']);
export const ALLOWLIST_EXPIRES_AT = '2026-08-10T00:00:00Z';

const ALLOWED_ADVISORY_URL = `https://github.com/advisories/${ALLOWED_ADVISORY}`;
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const KNOWN_SEVERITIES = new Set(['info', 'low', 'moderate', 'high', 'critical']);

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readAuditProcessResult(result) {
  if (result.error) {
    fail(`npm audit could not start: ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    fail(`npm audit exited unexpectedly with status ${String(result.status)}`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail('npm audit returned malformed JSON');
  }

  if (!isObject(report) || report.error) {
    fail('npm audit returned an error report');
  }
  return report;
}

function validateReportShape(report) {
  if (
    report.auditReportVersion !== 2
    || !isObject(report.vulnerabilities)
    || !isObject(report.metadata)
    || !isObject(report.metadata.vulnerabilities)
  ) {
    fail('npm audit report shape is unsupported');
  }

  for (const severity of KNOWN_SEVERITIES) {
    const count = report.metadata.vulnerabilities[severity];
    if (!Number.isInteger(count) || count < 0) {
      fail(`npm audit report is missing ${severity} metadata`);
    }
  }
  const expectedTotal = [...KNOWN_SEVERITIES].reduce(
    (total, severity) => total + report.metadata.vulnerabilities[severity],
    0,
  );
  if (report.metadata.vulnerabilities.total !== expectedTotal) {
    fail('npm audit total metadata does not match its severity counts');
  }

  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (
      !isObject(vulnerability)
      || !KNOWN_SEVERITIES.has(vulnerability.severity)
      || !Array.isArray(vulnerability.via)
      || !Array.isArray(vulnerability.nodes)
    ) {
      fail(`npm audit report contains an invalid vulnerability entry: ${name}`);
    }
  }
}

function validateLockfileShape(lockfile) {
  if (!isObject(lockfile) || !isObject(lockfile.packages)) {
    fail('package-lock.json shape is unsupported');
  }
}

function nodesAreDevOnly(vulnerability, lockfile) {
  if (!Array.isArray(vulnerability.nodes) || vulnerability.nodes.length === 0) {
    return false;
  }
  return vulnerability.nodes.every(node => lockfile.packages[node]?.dev === true);
}

function isAllowedRoot(vulnerability, lockfile) {
  if (
    vulnerability.severity !== 'high'
    || !Array.isArray(vulnerability.via)
    || vulnerability.via.length !== 1
    || !nodesAreDevOnly(vulnerability, lockfile)
  ) {
    return false;
  }

  const advisory = vulnerability.via[0];
  if (
    !isObject(advisory)
    || advisory.name !== ALLOWED_PACKAGE
    || advisory.severity !== 'high'
    || advisory.url !== ALLOWED_ADVISORY_URL
  ) {
    return false;
  }

  return vulnerability.nodes.every(node => ALLOWED_VERSIONS.has(lockfile.packages[node]?.version));
}

function isAllowedFinding(name, vulnerabilities, lockfile, memo, visiting) {
  if (memo.has(name)) {
    return memo.get(name);
  }
  if (visiting.has(name)) {
    return false;
  }

  const vulnerability = vulnerabilities[name];
  if (
    !isObject(vulnerability)
    || vulnerability.severity !== 'high'
    || !nodesAreDevOnly(vulnerability, lockfile)
  ) {
    memo.set(name, false);
    return false;
  }

  if (name === ALLOWED_PACKAGE) {
    const allowed = isAllowedRoot(vulnerability, lockfile);
    memo.set(name, allowed);
    return allowed;
  }

  if (!Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    memo.set(name, false);
    return false;
  }

  visiting.add(name);
  const allowed = vulnerability.via.every(
    via => typeof via === 'string'
      && isAllowedFinding(via, vulnerabilities, lockfile, memo, visiting),
  );
  visiting.delete(name);
  memo.set(name, allowed);
  return allowed;
}

export function evaluateAuditReport(report, lockfile, now = new Date()) {
  validateReportShape(report);
  validateLockfileShape(lockfile);

  const severeFindings = Object.entries(report.vulnerabilities).filter(
    ([, vulnerability]) => BLOCKING_SEVERITIES.has(vulnerability.severity),
  );
  const observedHighCount = severeFindings.filter(
    ([, vulnerability]) => vulnerability.severity === 'high',
  ).length;
  const observedCriticalCount = severeFindings.filter(
    ([, vulnerability]) => vulnerability.severity === 'critical',
  ).length;

  if (
    observedHighCount !== report.metadata.vulnerabilities.high
    || observedCriticalCount !== report.metadata.vulnerabilities.critical
  ) {
    fail('npm audit severity metadata does not match its findings');
  }
  if (severeFindings.some(([, vulnerability]) => vulnerability.severity === 'critical')) {
    fail('npm audit found a critical vulnerability');
  }
  if (severeFindings.length === 0) {
    return { allowlisted: [] };
  }
  if (now.getTime() >= Date.parse(ALLOWLIST_EXPIRES_AT)) {
    fail(`temporary ${ALLOWED_ADVISORY} allowlist expired`);
  }

  const memo = new Map();
  const allowlisted = [];
  for (const [name] of severeFindings) {
    if (!isAllowedFinding(name, report.vulnerabilities, lockfile, memo, new Set())) {
      fail(`npm audit found a non-allowlisted high vulnerability: ${name}`);
    }
    allowlisted.push(name);
  }

  return { allowlisted };
}

function run() {
  const audit = spawnSync('npm', ['audit', '--json'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  const report = readAuditProcessResult(audit);
  const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const result = evaluateAuditReport(report, lockfile);

  if (result.allowlisted.length === 0) {
    console.log('Release toolchain audit passed with no high or critical vulnerabilities.');
  } else {
    console.log(
      `Release toolchain audit passed with temporary ${ALLOWED_ADVISORY} allowlist `
      + `for dev-only ${ALLOWED_PACKAGE}; expires ${ALLOWLIST_EXPIRES_AT}.`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    console.error(`Release toolchain audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
