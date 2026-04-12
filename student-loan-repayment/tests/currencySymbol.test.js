const currencySymbol = require('../utils/currencySymbol');
const { NAME_TO_ISO } = require('../utils/currencySymbol');
const getSymbolFromCurrency = require('currency-symbol-map');

// Codes that are intentionally handled by our CODE_OVERRIDES rather than the package
const OVERRIDE_CODES = new Set(['SLE', 'ZWG']);

describe('currencySymbol', () => {
  // Verify every gov.uk currency name resolves to a symbol, not a fallback
  test.each(Object.keys(NAME_TO_ISO))(
    '"%s" resolves to a symbol (not the name itself)',
    (name) => {
      const result = currencySymbol(name);
      expect(result).not.toBe(name); // fallback returns the name
      expect(result.length).toBeGreaterThan(0);
    }
  );

  // Verify every ISO code is either recognised by currency-symbol-map or handled by CODE_OVERRIDES
  test.each(Object.entries(NAME_TO_ISO))(
    '"%s" → ISO code "%s" resolves via package or override',
    (name, isoCode) => {
      const fromPackage = getSymbolFromCurrency(isoCode);
      if (!OVERRIDE_CODES.has(isoCode)) {
        expect(fromPackage).toBeTruthy();
      } else {
        // Handled by CODE_OVERRIDES — the end-to-end result should still be a symbol
        expect(currencySymbol(name)).not.toBe(name);
      }
    }
  );

  // Spot-check a handful of well-known mappings
  test.each([
    ['Euro',           '€'],
    ['U.S. Dollar',    '$'],
    ['Yen',            '¥'],
    ['Zloty',          'zł'],
    ['New Israeli Shekel', '₪'],
    ['Swiss Franc',    'CHF'],
    ['Norwegian Krone','kr'],
    ['Ghanaian Cedi',  'GH₵'],     // currency-symbol-map returns GH₵ for GHS
    ['Thai Baht',      '฿'],
    ['Hong  Kong Dollar', '$'],    // double-space variant resolved via whitespace normalisation
    ['Indonesian  Rupiah', 'Rp'],  // double-space variant resolved via whitespace normalisation
    ['Leone',          'Le'],      // SLE override (too new for package)
    ['Zimbabwean Gold','ZiG'],     // ZWG override (too new for package)
  ])('currencySymbol("%s") === "%s"', (name, expected) => {
    expect(currencySymbol(name)).toBe(expected);
  });

  test('unknown name falls back to the name itself', () => {
    expect(currencySymbol('Imaginary Coin')).toBe('Imaginary Coin');
  });
});

// ─── Final || name fallback (line 169) ───────────────────────────────────────
// Covers the branch where the ISO code is in NAME_TO_ISO and not in
// CODE_OVERRIDES, but currency-symbol-map returns nothing for it.
describe('currencySymbol — package-returns-nothing fallback', () => {
  let mockedCurrencySymbol;

  beforeAll(() => {
    jest.resetModules();
    // Make currency-symbol-map always return undefined so every lookup
    // falls through to the final `|| name` arm.
    jest.doMock('currency-symbol-map', () => () => undefined);
    mockedCurrencySymbol = require('../utils/currencySymbol');
  });

  afterAll(() => {
    jest.resetModules();
  });

  test('returns the currency name when the package has no symbol for the ISO code', () => {
    // 'Euro' → ISO 'EUR', no CODE_OVERRIDE entry, package mocked to return
    // undefined → final fallback returns the original name 'Euro'.
    expect(mockedCurrencySymbol('Euro')).toBe('Euro');
  });
});
