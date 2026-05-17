'use strict';

const fs = require('fs');
const path = require('path');

function luminance(hex) {
  const rgb = hex.match(/[0-9a-f]{2}/gi).map((part) => parseInt(part, 16) / 255);
  const [r, g, b] = rgb.map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));

  return (lighter + 0.05) / (darker + 0.05);
}

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

  test('muted text variables retain accessible contrast', () => {
    const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');
    const rootTheme = css.match(/:root\s*\{([\s\S]*?)\n\}/)[1];
    const darkTheme = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)[1];
    const lightMuted = rootTheme.match(/--text-muted:\s*(#[0-9a-fA-F]{6})/)[1];
    const lightSurface = rootTheme.match(/--surface:\s*(#[0-9a-fA-F]{6})/)[1];
    const darkMuted = darkTheme.match(/--text-muted:\s*(#[0-9a-fA-F]{6})/)[1];
    const darkSurface = darkTheme.match(/--surface:\s*(#[0-9a-fA-F]{6})/)[1];

    expect(contrastRatio(lightMuted, lightSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkMuted, darkSurface)).toBeGreaterThanOrEqual(4.5);
  });
});
