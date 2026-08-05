const { readFileSync } = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://tjeucyzkjrirvvmxklmu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqZXVjeXpranJpcnZ2bXhrbG11Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMDQ4NjEsImV4cCI6MjA5MTY4MDg2MX0.d4fFLvV4nataORqpEPRF9H7QZIqrWZDSepw-Tl5hyxo';

module.exports = async (req, res) => {
  try {
    // Fetch SEO settings from Supabase
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/site_settings?key=in.(seo_title,seo_description,seo_og_image,hero_subtitle)&select=key,value`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );

    const settings = await response.json();
    const get = (key) => {
      const row = settings.find(s => s.key === key);
      return row ? row.value : null;
    };

    // Read the static index.html
    const htmlPath = path.join(__dirname, '..', '_index.html');
    let html = readFileSync(htmlPath, 'utf8');

    // Replace meta tags with current values from Supabase
    const seoTitle = get('seo_title');
    const seoDesc = get('seo_description');
    const seoOgImage = get('seo_og_image');

    if (seoTitle) {
      html = html.replace(
        /<title>[^<]*<\/title>/,
        `<title>${escapeHtml(seoTitle)}</title>`
      );
      html = html.replace(
        /<meta property="og:title" content="[^"]*">/,
        `<meta property="og:title" content="${escapeAttr(seoTitle)}">`
      );
    }

    if (seoDesc) {
      html = html.replace(
        /<meta name="description" content="[^"]*">/,
        `<meta name="description" content="${escapeAttr(seoDesc)}">`
      );
      html = html.replace(
        /<meta property="og:description" content="[^"]*">/,
        `<meta property="og:description" content="${escapeAttr(seoDesc)}">`
      );
    }

    if (seoOgImage) {
      html = html.replace(
        /<meta property="og:image" content="[^"]*">/,
        `<meta property="og:image" content="${escapeAttr(seoOgImage)}">`
      );
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err) {
    // If anything fails, serve the original static HTML as fallback
    const htmlPath = path.join(__dirname, '..', '_index.html');
    const html = readFileSync(htmlPath, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  }
};

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
