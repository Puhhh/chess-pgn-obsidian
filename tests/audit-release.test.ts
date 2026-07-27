import { describe, expect, it } from 'vitest';

import {
  ALLOWLIST_EXPIRES_AT,
  evaluateAuditReport,
  readAuditProcessResult,
} from '../scripts/audit-release.mjs';

interface Vulnerability {
  severity: 'high' | 'critical';
  via: Array<string | {
    name: string;
    severity: 'high';
    url: string;
  }>;
  nodes: string[];
}

function report(vulnerabilities: Record<string, Vulnerability>) {
  const values = Object.values(vulnerabilities);
  const high = values.filter(vulnerability => vulnerability.severity === 'high').length;
  const critical = values.filter(vulnerability => vulnerability.severity === 'critical').length;
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high,
        critical,
        total: high + critical,
      },
    },
  };
}

function allowedVulnerabilities(): Record<string, Vulnerability> {
  return {
    'brace-expansion': {
      severity: 'high',
      via: [{
        name: 'brace-expansion',
        severity: 'high',
        url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
      }],
      nodes: [
        'node_modules/tool-a/node_modules/brace-expansion',
        'node_modules/tool-b/node_modules/brace-expansion',
      ],
    },
    minimatch: {
      severity: 'high',
      via: ['brace-expansion'],
      nodes: ['node_modules/tool-a/node_modules/minimatch'],
    },
    eslint: {
      severity: 'high',
      via: ['minimatch'],
      nodes: ['node_modules/eslint'],
    },
  };
}

function allowedLockfile() {
  return {
    packages: {
      'node_modules/tool-a/node_modules/brace-expansion': { version: '1.1.16', dev: true },
      'node_modules/tool-b/node_modules/brace-expansion': { version: '2.1.2', dev: true },
      'node_modules/tool-a/node_modules/minimatch': { version: '3.1.5', dev: true },
      'node_modules/eslint': { version: '9.39.5', dev: true },
    },
  };
}

describe('release audit policy', () => {
  it('passes a clean audit even after the temporary allowlist expires', () => {
    expect(() =>
      evaluateAuditReport(report({}), { packages: {} }, new Date('2026-08-11T00:00:00Z')),
    ).not.toThrow();
  });

  it('allows only the approved advisory through dev-only compatible versions', () => {
    const result = evaluateAuditReport(
      report(allowedVulnerabilities()),
      allowedLockfile(),
      new Date('2026-07-27T00:00:00Z'),
    );

    expect(result.allowlisted).toEqual(['brace-expansion', 'minimatch', 'eslint']);
  });

  it('rejects another high-severity advisory', () => {
    const vulnerabilities = allowedVulnerabilities();
    vulnerabilities['brace-expansion'].via = [{
      name: 'brace-expansion',
      severity: 'high',
      url: 'https://github.com/advisories/GHSA-other',
    }];

    expect(() =>
      evaluateAuditReport(report(vulnerabilities), allowedLockfile(), new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/non-allowlisted high/i);
  });

  it('rejects every critical vulnerability', () => {
    const vulnerabilities = allowedVulnerabilities();
    vulnerabilities.eslint.severity = 'critical';

    expect(() =>
      evaluateAuditReport(report(vulnerabilities), allowedLockfile(), new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/critical vulnerability/i);
  });

  it('rejects the approved advisory when any affected package is production', () => {
    const lockfile = allowedLockfile();
    lockfile.packages['node_modules/tool-a/node_modules/brace-expansion'].dev = false;

    expect(() =>
      evaluateAuditReport(report(allowedVulnerabilities()), lockfile, new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/non-allowlisted high/i);
  });

  it('rejects an affected brace-expansion version outside the allowlist', () => {
    const lockfile = allowedLockfile();
    lockfile.packages['node_modules/tool-a/node_modules/brace-expansion'].version = '1.1.15';

    expect(() =>
      evaluateAuditReport(report(allowedVulnerabilities()), lockfile, new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/non-allowlisted high/i);
  });

  it('rejects the approved advisory after the allowlist expires', () => {
    expect(() =>
      evaluateAuditReport(
        report(allowedVulnerabilities()),
        allowedLockfile(),
        new Date(ALLOWLIST_EXPIRES_AT),
      ),
    ).toThrow(/allowlist expired/i);
  });

  it('rejects malformed output and audit process errors', () => {
    expect(() =>
      readAuditProcessResult({ status: 1, stdout: 'not json' }),
    ).toThrow(/malformed JSON/i);
    expect(() =>
      readAuditProcessResult({ status: 2, stdout: '{}' }),
    ).toThrow(/exited unexpectedly/i);
    expect(() =>
      readAuditProcessResult({ status: 1, stdout: '{"error":{"code":"ENETUNREACH"}}' }),
    ).toThrow(/error report/i);
  });

  it('rejects a transitive finding with an additional high-severity cause', () => {
    const vulnerabilities = allowedVulnerabilities();
    vulnerabilities.minimatch.via = [
      'brace-expansion',
      {
        name: 'minimatch',
        severity: 'high',
        url: 'https://github.com/advisories/GHSA-other',
      },
    ];

    expect(() =>
      evaluateAuditReport(report(vulnerabilities), allowedLockfile(), new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/non-allowlisted high/i);
  });

  it('rejects inconsistent severity metadata', () => {
    const auditReport = report(allowedVulnerabilities());
    auditReport.metadata.vulnerabilities.high += 1;

    expect(() =>
      evaluateAuditReport(auditReport, allowedLockfile(), new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/metadata does not match/i);
  });

  it('rejects an unsupported audit report version', () => {
    const auditReport = report({});
    auditReport.auditReportVersion = 3;

    expect(() =>
      evaluateAuditReport(auditReport, { packages: {} }, new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/shape is unsupported/i);
  });

  it('rejects a malformed vulnerability entry', () => {
    const auditReport = report({}) as ReturnType<typeof report> & {
      vulnerabilities: Record<string, Vulnerability | string>;
    };
    auditReport.vulnerabilities.hidden = 'malformed';

    expect(() =>
      evaluateAuditReport(auditReport, { packages: {} }, new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/invalid vulnerability entry/i);
  });

  it('rejects negative severity metadata', () => {
    const auditReport = report({});
    auditReport.metadata.vulnerabilities.high = -1;
    auditReport.metadata.vulnerabilities.critical = 1;

    expect(() =>
      evaluateAuditReport(auditReport, { packages: {} }, new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/missing high metadata/i);
  });

  it('rejects swapped high and critical metadata counts', () => {
    const auditReport = report(allowedVulnerabilities());
    auditReport.metadata.vulnerabilities.high -= 1;
    auditReport.metadata.vulnerabilities.critical += 1;

    expect(() =>
      evaluateAuditReport(auditReport, allowedLockfile(), new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/metadata does not match/i);
  });

  it('rejects inconsistent total vulnerability metadata', () => {
    const auditReport = report({});
    auditReport.metadata.vulnerabilities.total = 1;

    expect(() =>
      evaluateAuditReport(auditReport, { packages: {} }, new Date('2026-07-27T00:00:00Z')),
    ).toThrow(/total metadata does not match/i);
  });
});
