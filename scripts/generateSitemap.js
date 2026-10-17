const fs = require('fs');
const path = require('path');

const products = require('../server/data/products_master.json');
const today = new Date().toISOString().split('T')[0];

let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

// Core Pages
const corePages = [
  { url: 'https://audioking.co.in/', priority: '1.0', changefreq: 'daily' },
  { url: 'https://audioking.co.in/store', priority: '0.9', changefreq: 'daily' },
  { url: 'https://audioking.co.in/catalog', priority: '0.9', changefreq: 'daily' },
  { url: 'https://audioking.co.in/brands', priority: '0.8', changefreq: 'weekly' },
  { url: 'https://audioking.co.in/contact', priority: '0.7', changefreq: 'monthly' }
];

for (const p of corePages) {
  xml += '  <url>\n';
  xml += `    <loc>${p.url}</loc>\n`;
  xml += `    <lastmod>${today}</lastmod>\n`;
  xml += `    <changefreq>${p.changefreq}</changefreq>\n`;
  xml += `    <priority>${p.priority}</priority>\n`;
  xml += '  </url>\n';
}

// Product Pages
for (const prod of products) {
  if (!prod.id) continue;
  const cleanId = encodeURIComponent(String(prod.id).trim());
  xml += '  <url>\n';
  xml += `    <loc>https://audioking.co.in/product/${cleanId}</loc>\n`;
  xml += `    <lastmod>${today}</lastmod>\n`;
  xml += '    <changefreq>weekly</changefreq>\n';
  xml += '    <priority>0.8</priority>\n';
  xml += '  </url>\n';
}

xml += '</urlset>\n';

const outPath = path.resolve(__dirname, '..', 'sitemap.xml');
fs.writeFileSync(outPath, xml, 'utf8');
console.log(`Generated sitemap.xml with ${corePages.length + products.length} URLs at ${outPath}`);
