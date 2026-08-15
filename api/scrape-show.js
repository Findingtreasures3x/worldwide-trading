module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { url } = req.body || {};
    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Valid URL required' });
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorldwideTrading/1.0)' }
    });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const html = await response.text();

    const result = {};

    // Helper to extract meta tag content
    const meta = (prop) => {
      const patterns = [
        new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'),
        new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${prop}["']`, 'i'),
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) return decodeHtmlEntities(m[1]);
      }
      return null;
    };

    // Name: og:title or <title>
    result.name = meta('og:title') || meta('twitter:title');
    if (!result.name) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) result.name = decodeHtmlEntities(titleMatch[1]).trim();
    }

    // Description
    result.description = meta('og:description') || meta('description') || meta('twitter:description');

    // Image
    result.image = meta('og:image') || meta('twitter:image');
    if (result.image && result.image.startsWith('/')) {
      const urlObj = new URL(url);
      result.image = urlObj.origin + result.image;
    }

    // Try to extract date patterns from the page text
    const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    // Date patterns: "August 30, 2026", "Aug 30 2026", "08/30/2026", etc.
    const datePatterns = [
      /(\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i,
      /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/i,
      /(\b\d{1,2}\/\d{1,2}\/\d{4})/,
    ];
    for (const dp of datePatterns) {
      const dm = textContent.match(dp);
      if (dm) {
        const cleaned = dm[1].replace(/(st|nd|rd|th)/gi, '');
        const parsed = new Date(cleaned);
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= 2026) {
          result.date = parsed.toISOString();
          break;
        }
      }
    }

    // Try to find address patterns (look for state abbreviations + zip)
    const addressMatch = textContent.match(/(\d+[^,\n]{3,40},\s*[A-Za-z\s]+,\s*[A-Z]{2}\s*\d{5})/);
    if (addressMatch) {
      result.address = addressMatch[1].trim();
    }

    // Try to find location/venue name from structured data
    const ldJsonMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (ldJsonMatches) {
      for (const block of ldJsonMatches) {
        try {
          const jsonStr = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '');
          const ld = JSON.parse(jsonStr);
          const event = ld['@type'] === 'Event' ? ld : (Array.isArray(ld['@graph']) ? ld['@graph'].find(x => x['@type'] === 'Event') : null);
          if (event) {
            if (event.name && !result.name) result.name = event.name;
            if (event.startDate) result.date = new Date(event.startDate).toISOString();
            if (event.endDate) result.endDate = new Date(event.endDate).toISOString();
            if (event.location) {
              const loc = event.location;
              if (loc.name) result.locationName = loc.name;
              if (loc.address) {
                const addr = typeof loc.address === 'string' ? loc.address : [loc.address.streetAddress, loc.address.addressLocality, loc.address.addressRegion, loc.address.postalCode].filter(Boolean).join(', ');
                result.address = addr;
              }
            }
            if (event.image) result.image = typeof event.image === 'string' ? event.image : (event.image.url || event.image[0]);
          }
        } catch (e) { /* ignore malformed JSON-LD */ }
      }
    }

    // Also search for inline JSON-LD Event data (common in Next.js/React sites)
    // Handle both regular quotes and escaped quotes (\"startDate\":\"...\")
    const startDateMatch = html.match(/\\?"startDate\\?"\s*:\\?\s*\\?"([^"\\]+)\\?"/);
    if (startDateMatch && !result.date) {
      // Look for explicit start_time and date fields to get accurate local time
      const startTimeMatch = html.match(/\\?"start_time\\?"\s*:\\?\s*\\?"([^"\\]+)\\?"/);
      const dateOnlyMatch = html.match(/\\?"(?:min_date|date)\\?"\s*:\\?\s*\\?"(\d{4}-\d{2}-\d{2})\\?"/);
      if (dateOnlyMatch && startTimeMatch) {
        // Combine date + time as local time (no Z suffix)
        result.date = `${dateOnlyMatch[1]}T${startTimeMatch[1]}`;
      } else {
        // Extract just the date portion and default to 10:00 AM local
        const dateStr = startDateMatch[1].split('T')[0];
        result.date = `${dateStr}T10:00:00`;
      }
    }
    const endDateMatch = html.match(/\\?"endDate\\?"\s*:\\?\s*\\?"([^"\\]+)\\?"/);
    if (endDateMatch && !result.endDate) {
      const endTimeMatch = html.match(/\\?"end_time\\?"\s*:\\?\s*\\?"([^"\\]+)\\?"/);
      const dateStr = endDateMatch[1].split('T')[0];
      if (endTimeMatch) {
        result.endDate = `${dateStr}T${endTimeMatch[1]}`;
      } else {
        result.endDate = `${dateStr}T17:00:00`;
      }
    }

    // Try to find location/venue name from inline data (handles escaped quotes too)
    const venuePatterns = [
      /\\?"venue_name\\?"\s*:\\?\s*\\?"([^"\\]+)\\?"/,
      /"venue_name"\s*:\s*"([^"]+)"/,
      /\\?"location_name\\?"\s*:\\?\s*\\?"([^"\\]+)\\?"/,
      /"@type"\s*:\s*"Place"\s*,\s*"name"\s*:\s*"([^"]+)"/,
    ];
    for (const vp of venuePatterns) {
      const vm = html.match(vp);
      if (vm && !result.locationName) {
        result.locationName = vm[1];
        break;
      }
    }

    // Event URL
    result.eventUrl = url;

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

function decodeHtmlEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}
