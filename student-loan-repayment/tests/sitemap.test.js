'use strict';

const fs = require('fs');
const path = require('path');
const { buildSitemapXml } = require('../scripts/generateSitemap');
const { getSitemapEntries } = require('../config/seoPages');

describe('sitemap generation', () => {
  test('checked-in sitemap matches the generator output', () => {
    const sitemapPath = path.join(__dirname, '../public/sitemap.xml');
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const lastmod = sitemap.match(/<lastmod>([^<]+)<\/lastmod>/)[1];

    expect(sitemap).toBe(buildSitemapXml(lastmod));
  });

  test('sitemap includes every configured canonical URL once', () => {
    const sitemapPath = path.join(__dirname, '../public/sitemap.xml');
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const locs = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
    const expectedLocs = getSitemapEntries('2026-05-04').map((entry) => entry.loc);

    expect(locs).toEqual(expectedLocs);
    expect(new Set(locs).size).toBe(locs.length);
  });
});
