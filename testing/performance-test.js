#!/usr/bin/env node

/**
 * Performance Test Suite for SMT Verification System
 * Runs multiple load test scenarios and generates report
 * 
 * Usage: node performance-test.js [--api-url http://localhost:3001] [--scenario all|login|scan|export]
 */

const http = require('http');
const https = require('https');
const url = require('url');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3001';
const SCENARIO = process.env.SCENARIO || 'all';
const DURATION = parseInt(process.env.DURATION) || 30; // seconds

// Metrics
const metrics = {
  requests: 0,
  succeeded: 0,
  failed: 0,
  latencies: [],
  errors: {},
  startTime: 0,
  endTime: 0,
};

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const urlObj = new URL(API_URL);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      timeout: 10000,
    };

    const req = client.request(options, (res) => {
      let responseBody = '';

      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        const latency = Date.now() - startTime;
        metrics.latencies.push(latency);
        metrics.requests++;

        if (res.statusCode >= 200 && res.statusCode < 300) {
          metrics.succeeded++;
        } else {
          metrics.failed++;
          metrics.errors[res.statusCode] = (metrics.errors[res.statusCode] || 0) + 1;
        }

        resolve({
          statusCode: res.statusCode,
          latency: latency,
          body: responseBody,
        });
      });
    });

    req.on('error', (error) => {
      metrics.requests++;
      metrics.failed++;
      const errorKey = error.code || error.message;
      metrics.errors[errorKey] = (metrics.errors[errorKey] || 0) + 1;
      resolve({ statusCode: 0, latency: 0, error: error.message });
    });

    req.on('timeout', () => {
      req.destroy();
      metrics.requests++;
      metrics.failed++;
      metrics.errors['TIMEOUT'] = (metrics.errors['TIMEOUT'] || 0) + 1;
      resolve({ statusCode: 0, latency: 10000, error: 'Timeout' });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function scenario_login() {
  log(colors.cyan, '\n[SCENARIO] Login Load Test');
  log(colors.cyan, `Duration: ${DURATION}s, Target: 10 concurrent users`);

  const startTime = Date.now();
  let completed = 0;

  while (Date.now() - startTime < DURATION * 1000) {
    const promises = [];

    for (let i = 0; i < 10; i++) {
      promises.push(
        makeRequest('POST', '/api/auth/login', {
          username: `operator${(i % 2) + 1}`,
          password: 'operator123',
          role: 'operator',
        })
      );
    }

    await Promise.all(promises);
    completed += 10;

    process.stdout.write(`\rRequests: ${completed}`);
  }

  process.stdout.write('\n');
}

async function scenario_scan() {
  log(colors.cyan, '\n[SCENARIO] Scan Operations Load Test');
  log(colors.cyan, `Duration: ${DURATION}s, Target: 50 concurrent scans`);

  // Create session first
  const sessionRes = await makeRequest('POST', '/api/verification/sessions', {
    bomId: 1,
    mode: 'AUTO',
  });

  let sessionId = 1;
  try {
    const sessionData = JSON.parse(sessionRes.body);
    sessionId = sessionData.id || 1;
  } catch (e) {}

  const startTime = Date.now();
  let completed = 0;

  while (Date.now() - startTime < DURATION * 1000) {
    const promises = [];

    for (let i = 0; i < 50; i++) {
      promises.push(
        makeRequest('POST', '/api/verification/scan', {
          sessionId: sessionId,
          feederNumber: String(i + 1),
          scannedValue: 'C0603C472K5RACAUTO',
          quantity: 100,
        })
      );
    }

    await Promise.all(promises);
    completed += 50;

    process.stdout.write(`\rScans: ${completed}`);
  }

  process.stdout.write('\n');
}

async function scenario_export() {
  log(colors.cyan, '\n[SCENARIO] Export Operations Load Test');
  log(colors.cyan, `Duration: ${DURATION}s, Target: 5 concurrent exports`);

  const startTime = Date.now();
  let completed = 0;

  while (Date.now() - startTime < DURATION * 1000) {
    const promises = [];

    for (let i = 0; i < 5; i++) {
      promises.push(
        makeRequest('POST', '/api/reports/export/pdf', {
          sessionId: 1,
        })
      );
    }

    await Promise.all(promises);
    completed += 5;

    process.stdout.write(`\rExports: ${completed}`);
  }

  process.stdout.write('\n');
}

async function scenario_health() {
  log(colors.cyan, '\n[SCENARIO] Health Check Load Test');
  log(colors.cyan, `Duration: ${DURATION}s, Target: 100 concurrent checks`);

  const startTime = Date.now();
  let completed = 0;

  while (Date.now() - startTime < DURATION * 1000) {
    const promises = [];

    for (let i = 0; i < 100; i++) {
      promises.push(makeRequest('GET', '/api/health'));
    }

    await Promise.all(promises);
    completed += 100;

    process.stdout.write(`\rRequests: ${completed}`);
  }

  process.stdout.write('\n');
}

function calculateStats() {
  const sorted = metrics.latencies.sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    total: metrics.requests,
    succeeded: metrics.succeeded,
    failed: metrics.failed,
    errorRate: ((metrics.failed / metrics.requests) * 100).toFixed(2),
    minLatency: Math.min(...sorted),
    maxLatency: Math.max(...sorted),
    avgLatency: (sum / sorted.length).toFixed(2),
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  };
}

async function runTests() {
  log(colors.blue, '════════════════════════════════════════════════════════════════════════');
  log(colors.blue, '  SMT Verification System - Performance Test Suite');
  log(colors.blue, '════════════════════════════════════════════════════════════════════════');
  log(colors.reset, `\nAPI URL: ${API_URL}`);
  log(colors.reset, `Scenario: ${SCENARIO}`);
  log(colors.reset, `Duration: ${DURATION}s\n`);

  metrics.startTime = Date.now();

  try {
    if (SCENARIO === 'all' || SCENARIO === 'health') await scenario_health();
    if (SCENARIO === 'all' || SCENARIO === 'login') await scenario_login();
    if (SCENARIO === 'all' || SCENARIO === 'scan') await scenario_scan();
    if (SCENARIO === 'all' || SCENARIO === 'export') await scenario_export();
  } catch (error) {
    log(colors.red, `\nError: ${error.message}`);
  }

  metrics.endTime = Date.now();

  const stats = calculateStats();

  log(colors.blue, '\n════════════════════════════════════════════════════════════════════════');
  log(colors.blue, '  Performance Test Results');
  log(colors.blue, '════════════════════════════════════════════════════════════════════════\n');

  log(colors.cyan, 'Request Summary:');
  log(colors.reset, `  Total Requests: ${stats.total}`);
  log(colors.green, `  Succeeded: ${stats.succeeded}`);
  log(stats.failed > 0 ? colors.red : colors.green, `  Failed: ${stats.failed}`);
  log(stats.errorRate > 1 ? colors.red : colors.green, `  Error Rate: ${stats.errorRate}%`);

  log(colors.cyan, '\nLatency Metrics (ms):');
  log(colors.reset, `  Min: ${stats.minLatency}ms`);
  log(colors.reset, `  Avg: ${stats.avgLatency}ms`);
  log(colors.reset, `  Max: ${stats.maxLatency}ms`);
  log(colors.reset, `  p50: ${stats.p50}ms`);
  log(stats.p95 > 500 ? colors.yellow : colors.green, `  p95: ${stats.p95}ms`);
  log(stats.p99 > 1000 ? colors.yellow : colors.green, `  p99: ${stats.p99}ms`);

  if (Object.keys(metrics.errors).length > 0) {
    log(colors.cyan, '\nError Breakdown:');
    Object.entries(metrics.errors).forEach(([code, count]) => {
      log(colors.reset, `  ${code}: ${count}`);
    });
  }

  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const throughput = (stats.total / duration).toFixed(2);

  log(colors.cyan, '\nThroughput:');
  log(colors.reset, `  ${throughput} req/s`);

  log(colors.blue, '\n════════════════════════════════════════════════════════════════════════');

  // Pass/fail determination
  const passed =
    stats.failed === 0 &&
    stats.errorRate < 1 &&
    stats.p95 < 1000 &&
    stats.total > 10;

  if (passed) {
    log(colors.green, '✅ Performance test PASSED');
  } else {
    log(colors.red, '❌ Performance test FAILED');
    if (stats.failed > 0) log(colors.red, '   - Requests failed');
    if (stats.errorRate > 1) log(colors.red, `   - Error rate too high (${stats.errorRate}%)`);
    if (stats.p95 > 1000) log(colors.red, `   - p95 latency too high (${stats.p95}ms)`);
  }

  process.exit(passed ? 0 : 1);
}

// Parse command line arguments
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--api-url') {
    process.env.API_URL = process.argv[++i];
  } else if (process.argv[i] === '--scenario') {
    process.env.SCENARIO = process.argv[++i];
  } else if (process.argv[i] === '--duration') {
    process.env.DURATION = process.argv[++i];
  }
}

runTests();
