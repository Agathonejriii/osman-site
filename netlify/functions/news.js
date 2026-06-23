// Netlify Function - Ugandan News via RSS feeds
const axios = require('axios');

const FEEDS = {
  entertainment: [
    // Galaxy FM - WordPress, gossip category
    'https://www.galaxyfm.co.ug/gossip/feed/',
    // MBU - WordPress
    'https://mbu.ug/feed/',
    // BigEye - WordPress (home feed + entertainment category, in case they differ)
    'https://bigeye.ug/feed/',
    'https://bigeye.ug/category/entertainment-news/feed/',
    // Sqoop - custom CMS, try common RSS conventions (one of these should resolve)
    'https://www.sqoop.co.ug/rss',
    'https://www.sqoop.co.ug/feed',
    'https://www.sqoop.co.ug/rss.xml',
    // Howwe - confirmed RSS feed (linked in their site footer)
    'https://www.howwe.ug/feed',
  ],
  sports: [
    'https://www.independent.co.ug/sports/feed/',
    'https://www.newvision.co.ug/sports/feed/',
    'https://nilepost.co.ug/sports/feed/',
    'https://observer.ug/sportsnews/feed/',
    'https://www.chimp.net/category/sports/feed/',
  ],
  music: [
    'https://mbu.ug/feed/',
    'https://bigeye.ug/feed/',
    'https://mulengeranews.com/feed/',
    'https://www.howwe.biz/feed/',
  ],
  gossip: [
    'https://www.galaxyfm.co.ug/gossip/feed/',
    'https://mulengeranews.com/feed/',
    'https://nilepost.co.ug/entertainment/feed/',
    'https://www.howwe.biz/feed/',
    'https://www.chimp.net/feed/',
  ],
  politics: [
    'https://www.independent.co.ug/all-news/feed/',
    'https://www.monitor.co.ug/uganda/news/feed/',
    'https://observer.ug/news/headlines/feed/',
    'https://nilepost.co.ug/politics/feed/',
    'https://mulengeranews.com/feed/',
    'https://www.newvision.co.ug/feed/',
    'https://www.chimp.net/category/politics/feed/',
  ],
};

const SOURCE_NAMES = {
  'independent.co.ug':   'The Independent',
  'newvision.co.ug':     'New Vision',
  'monitor.co.ug':       'Daily Monitor',
  'nilepost.co.ug':      'Nile Post',
  'mulengeranews.com':   'Mulengera News',
  'matookerepublic.com': 'Matooke Republic',
  'observer.ug':         'The Observer',
  'howwe.biz':           'Howwe',
  'howwe.ug':            'Howwe',
  'chimp.net':           'Chimp Reports',
  'galaxyfm.co.ug':      'Galaxy FM',
  'mbu.ug':              'MBU',
  'bigeye.ug':           'BigEye',
  'sqoop.co.ug':         'Sqoop',
};

// Minimal safety-net filter for the most overtly explicit terms in a headline.
// This is a conservative backstop only - it will not catch everything,
// and is not a substitute for manual review of the live site.
const EXPLICIT_TERM_BLOCKLIST = [
  'nude', 'nudes', 'naked', 'sex tape', 'xxx', 'porn', 'leaked video',
  'leaked nudes', 'explicit video', 'bedroom video', 's*x', 's3x'
];

function isExplicit(title) {
  const lower = (title || '').toLowerCase();
  return EXPLICIT_TERM_BLOCKLIST.some(term => lower.includes(term));
}

function getSourceName(url) {
  for (const [domain, name] of Object.entries(SOURCE_NAMES)) {
    if (url.includes(domain)) return name;
  }
  return 'Uganda News';
}

function parseRSS(xml, sourceName) {
  const articles = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  items.slice(0, 6).forEach(item => {
    const get = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };

    const title = get('title');
    const link  = get('link') || get('guid');
    const desc  = get('description').replace(/<[^>]+>/g, '').slice(0, 200);
    const date  = get('pubDate');

    let img = '';
    const mediaMatch     = item.match(/media:content[^>]+url="([^"]+)"/);
    const enclosureMatch = item.match(/enclosure[^>]+url="([^"]+)"/);
    const imgTagMatch    = item.match(/<img[^>]+src="([^"]+)"/);
    if (mediaMatch)     img = mediaMatch[1];
    else if (enclosureMatch) img = enclosureMatch[1];
    else if (imgTagMatch)    img = imgTagMatch[1];

    if (title && link && !isExplicit(title)) {
      articles.push({
        title,
        url: link,
        urlToImage: img || null,
        description: desc,
        source: { name: sourceName },
        publishedAt: date ? new Date(date).toISOString() : new Date().toISOString()
      });
    }
  });

  return articles;
}

exports.handler = async (event) => {
  const { category } = event.queryStringParameters || {};
  const feeds = FEEDS[category] || FEEDS.politics;

  try {
    const results = await Promise.allSettled(
      feeds.map(feedUrl =>
        axios.get(feedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml'
          },
          timeout: 8000
        }).then(res => parseRSS(res.data, getSourceName(feedUrl)))
      )
    );

    let articles = [];
    results.forEach(r => {
      if (r.status === 'fulfilled') articles.push(...r.value);
    });

    // Sort newest first
    articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Deduplicate by title
    const seen = new Set();
    articles = articles.filter(a => {
      if (seen.has(a.title)) return false;
      seen.add(a.title);
      return true;
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify({ articles, totalResults: articles.length })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ articles: [], error: error.message })
    };
  }
};