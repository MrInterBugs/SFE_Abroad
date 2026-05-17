'use strict';

function loadLegalWithEnv(env = {}) {
  const saved = {
    LEGAL_OPERATOR_NAME: process.env.LEGAL_OPERATOR_NAME,
    LEGAL_OPERATOR_ADDRESS: process.env.LEGAL_OPERATOR_ADDRESS,
    LEGAL_CONTACT_EMAIL: process.env.LEGAL_CONTACT_EMAIL,
    LEGAL_CONTACT_PHONE: process.env.LEGAL_CONTACT_PHONE,
    LEGAL_VAT_ID: process.env.LEGAL_VAT_ID,
    LEGAL_CONTENT_RESPONSIBLE_NAME: process.env.LEGAL_CONTENT_RESPONSIBLE_NAME,
    LEGAL_CONTENT_RESPONSIBLE_ADDRESS: process.env.LEGAL_CONTENT_RESPONSIBLE_ADDRESS,
    LEGAL_HOST_NAME: process.env.LEGAL_HOST_NAME,
    LEGAL_HOST_PRIVACY_URL: process.env.LEGAL_HOST_PRIVACY_URL,
  };

  Object.keys(saved).forEach((key) => delete process.env[key]);
  Object.assign(process.env, env);
  jest.resetModules();
  const legal = require('../config/legal');

  Object.keys(saved).forEach((key) => {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  });
  jest.resetModules();

  return legal;
}

describe('legal config', () => {
  test('uses safe defaults when public legal details are not configured', () => {
    const legal = loadLegalWithEnv();

    expect(legal.operatorName).toBe('Aedan L');
    expect(legal.addressLines).toEqual([]);
    expect(legal.contactEmail).toBe('admin@mrinterbugs.uk');
    expect(legal.hasCompleteImpressum).toBe(false);
  });

  test('parses configured public legal details', () => {
    const legal = loadLegalWithEnv({
      LEGAL_OPERATOR_NAME: 'Example Operator',
      LEGAL_OPERATOR_ADDRESS: 'Line 1 | Line 2',
      LEGAL_CONTACT_EMAIL: 'legal@example.com',
      LEGAL_CONTACT_PHONE: '+49 000 000',
      LEGAL_VAT_ID: 'DE123456789',
      LEGAL_CONTENT_RESPONSIBLE_NAME: 'Editor Name',
      LEGAL_CONTENT_RESPONSIBLE_ADDRESS: 'Editor Line 1 | Editor Line 2',
      LEGAL_HOST_NAME: 'Example Host',
      LEGAL_HOST_PRIVACY_URL: 'https://example.com/privacy',
    });

    expect(legal.operatorName).toBe('Example Operator');
    expect(legal.addressLines).toEqual(['Line 1', 'Line 2']);
    expect(legal.contactEmail).toBe('legal@example.com');
    expect(legal.contactPhone).toBe('+49 000 000');
    expect(legal.vatId).toBe('DE123456789');
    expect(legal.contentResponsibleName).toBe('Editor Name');
    expect(legal.contentResponsibleAddressLines).toEqual(['Editor Line 1', 'Editor Line 2']);
    expect(legal.hostName).toBe('Example Host');
    expect(legal.hostPrivacyUrl).toBe('https://example.com/privacy');
    expect(legal.hasCompleteImpressum).toBe(true);
  });
});
