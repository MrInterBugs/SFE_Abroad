'use strict';

const fs = require('fs');
const path = require('path');

describe('public styles', () => {
  test('hidden plan and PGL controls are not displayed', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

    expect(css).toMatch(/\[hidden\][\s\S]*display:\s*none\s*!important/);
    expect(css).toMatch(/\.plan-card\[hidden\][\s\S]*display:\s*none\s*!important/);
    expect(css).toMatch(/\.checkbox-row\[hidden\][\s\S]*display:\s*none\s*!important/);
  });

  test('surface variable is defined for guide cards in both themes', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

    expect(css).toMatch(/:root[\s\S]*--surface:\s*#[0-9a-fA-F]{6}/);
    expect(css).toMatch(/\[data-theme="dark"\][\s\S]*--surface:\s*#[0-9a-fA-F]{6}/);
    expect(css).toMatch(/\.guide-link-card[\s\S]*background:\s*var\(--surface\)/);
  });
});
