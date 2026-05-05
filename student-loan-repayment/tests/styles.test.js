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
});
