// Netlify Function - Howwe.ug Hot 100 Uganda Music Chart
const axios = require('axios');

const HOT100_URL = 'https://www.howwe.ug/hot100';

function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

// Howwe renders each chart entry as:
// <li id="SONGID"><a href='/song/ID/slug/ARTISTID/artist-slug' ...>
//   ... <span class="...text-2xl sm:text-4xl">RANK</span> ...
//   <span class="...text-howwepink-600 dark:text-howwepink-100">TITLE</span>
//   <span class="...text-howweblue-900 dark:text-howwepurple-100">ARTIST</span>
// </a></li>
function parseHot100(html) {
  const songs = [];

  // Split into individual <li ...>...</li> blocks for each chart entry
  const liRegex = /<li[^>]*id="(\d+)"[^>]*>([\s\S]*?)<\/li>/g;
  let liMatch;

  while ((liMatch = liRegex.exec(html)) !== null) {
    const block = liMatch[2];

    // Song permalink (relative URL)
    const hrefMatch = block.match(/<a\s+href='(\/song\/[^']+)'/) || block.match(/<a\s+href="(\/song\/[^"]+)"/);
    if (!hrefMatch) continue;
    const url = 'https://www.howwe.ug' + hrefMatch[1];

    // Rank: the big bold number badge, e.g. class="...text-2xl sm:text-4xl">73</span>
    const rankMatch = block.match(/text-2xl sm:text-4xl'>\s*(\d{1,3})\s*<\/span>/);
    if (!rankMatch) continue;
    const rank = parseInt(rankMatch[1], 10);
    if (rank < 1 || rank > 100) continue;

    // Title: span with howwepink-600 / howwepink-100 classes
    const titleMatch = block.match(/text-howwepink-600 dark:text-howwepink-100'>([\s\S]*?)<\/span>/);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';

    // Artist: span with howweblue-900 / howwepurple-100 classes
    const artistMatch = block.match(/text-howweblue-900 dark:text-howwepurple-100'>([\s\S]*?)<\/span>/);
    const artist = artistMatch ? stripTags(artistMatch[1]) : '';

    // Cover image, if present (skip the generic "no artwork" placeholder)
    const imgMatch = block.match(/<img[^>]+src='([^']+)'/) || block.match(/<img[^>]+src="([^"]+)"/);
    let image = imgMatch ? imgMatch[1] : null;
    if (image && image.includes('noartwork')) image = null;

    if (!title) continue;

    songs.push({ rank, title, artist, url, image });
  }

  // De-dupe by rank (in case of stray matches) and sort
  const byRank = new Map();
  songs.forEach(s => { if (!byRank.has(s.rank)) byRank.set(s.rank, s); });

  return Array.from(byRank.values()).sort((a, b) => a.rank - b.rank);
}

exports.handler = async () => {
  try {
    const res = await axios.get(HOT100_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      },
      timeout: 10000
    });

    const songs = parseHot100(res.data);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=900'
      },
      body: JSON.stringify({ songs, totalResults: songs.length, source: 'Howwe Hot 100', sourceUrl: HOT100_URL })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ songs: [], error: error.message })
    };
  }
};