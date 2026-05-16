'use strict';

jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { EventEmitter } = require('events');
const https = require('https');
const logger = require('../utils/logger');
const {
  sendEmail,
  sendEmailConfirmation,
  sendPasswordReset,
  appBaseUrl,
  emailFrom,
  resendTimeoutMs,
} = require('../utils/email');

function mockResend(statusCode = 200, responseBody = '{"id":"email-id"}') {
  const writes = [];
  https.request = jest.fn((options, callback) => {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.setEncoding = jest.fn();
    process.nextTick(() => {
      callback(res);
      res.emit('data', responseBody);
      res.emit('end');
    });

    const req = new EventEmitter();
    req.write = chunk => writes.push(chunk);
    req.end = jest.fn();
    req.setTimeout = jest.fn();
    req.destroy = jest.fn((err) => req.emit('error', err));
    return req;
  });
  return writes;
}

describe('email utilities', () => {
  const originalEnv = process.env;
  const originalRequest = https.request;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.APP_BASE_URL;
    delete process.env.EMAIL_FROM;
    delete process.env.RESEND_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = originalEnv;
    https.request = originalRequest;
  });

  test('sendEmail skips delivery when Resend is not configured', async () => {
    expect(appBaseUrl()).toBe('http://localhost:3000');

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    })).resolves.toBe(false);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('RESEND_API_KEY'));
  });

  test('sendEmail posts to Resend when configured', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM = 'Sender <sender@example.com>';
    const writes = mockResend();

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    })).resolves.toBe(true);

    expect(https.request).toHaveBeenCalledWith(expect.objectContaining({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
    }), expect.any(Function));
    expect(https.request.mock.calls[0][0].headers['User-Agent']).toBe('student-loan-repayment/1.0');
    expect(https.request.mock.results[0].value.setTimeout).toHaveBeenCalledWith(10000, expect.any(Function));
    expect(JSON.parse(writes[0])).toMatchObject({
      from: 'Sender <sender@example.com>',
      to: 'user@example.com',
      subject: 'Subject',
    });
  });

  test('sendEmail rejects Resend errors', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    mockResend(401, '{"message":"bad key"}');

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    })).rejects.toThrow('Resend returned 401');
  });

  test('sendEmail rejects stalled Resend requests after the configured timeout', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_TIMEOUT_MS = '25';
    https.request = jest.fn((_options, _callback) => {
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end = jest.fn();
      req.destroy = jest.fn((err) => req.emit('error', err));
      req.setTimeout = jest.fn((_ms, cb) => process.nextTick(cb));
      return req;
    });

    await expect(sendEmail({
      to: 'user@example.com',
      subject: 'Subject',
      html: '<p>Hello</p>',
      text: 'Hello',
    })).rejects.toThrow('Resend request timed out after 25ms');

    expect(resendTimeoutMs()).toBe(25);
  });

  test('confirmation and reset helpers build links from configured base URL', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.APP_BASE_URL = 'https://sfe.example.com/';
    const writes = mockResend();

    expect(appBaseUrl()).toBe('https://sfe.example.com');
    expect(emailFrom()).toBe('Student Finance Overseas Calculator <onboarding@resend.dev>');

    await sendEmailConfirmation('user@example.com', 'confirm-token');
    await sendPasswordReset('user@example.com', 'reset-token');

    expect(JSON.parse(writes[0]).text).toContain('https://sfe.example.com/confirm-email/confirm-token');
    expect(JSON.parse(writes[1]).text).toContain('https://sfe.example.com/reset-password/reset-token');
  });
});
