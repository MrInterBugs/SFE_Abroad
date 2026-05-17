function splitAddress(value) {
  return String(value || '')
    .split('|')
    .map((line) => line.trim())
    .filter(Boolean);
}

const legal = {
  serviceName: 'Student Finance Overseas Repayment Calculator',
  operatorName: process.env.LEGAL_OPERATOR_NAME || 'Aedan L',
  addressLines: splitAddress(process.env.LEGAL_OPERATOR_ADDRESS),
  contactEmail: process.env.LEGAL_CONTACT_EMAIL || 'admin@mrinterbugs.uk',
  contactPhone: process.env.LEGAL_CONTACT_PHONE || '',
  vatId: process.env.LEGAL_VAT_ID || '',
  contentResponsibleName: process.env.LEGAL_CONTENT_RESPONSIBLE_NAME || process.env.LEGAL_OPERATOR_NAME || 'Aedan L',
  contentResponsibleAddressLines: splitAddress(process.env.LEGAL_CONTENT_RESPONSIBLE_ADDRESS || process.env.LEGAL_OPERATOR_ADDRESS),
  hostName: process.env.LEGAL_HOST_NAME || 'Hosting provider',
  hostPrivacyUrl: process.env.LEGAL_HOST_PRIVACY_URL || '',
};

legal.hasCompleteImpressum = Boolean(
  legal.operatorName &&
  legal.addressLines.length &&
  legal.contactEmail
);

module.exports = legal;
