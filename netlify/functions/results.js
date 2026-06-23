// Netlify Function - Recent Match Result Headlines via Uganda RSS feeds
// Reuses the same feed sources as news.js but filters specifically for
// football/sports result-style headlines (World Cup, EPL, UPL, Cranes, etc).
const axios = require('axios');

const RESULT_FEEDS = [
  'https://www.independent.co.ug/sports/feed/',
  'https://www.newvision.co.ug/sports/feed/',
  'https://nilepost.co.ug/sports/feed/',
  'https://observer.ug/sportsnews/feed/',
  'https://www.chimp.net/category/sports/feed/',
];

const SOURCE_NAMES = {
  'independent.co.ug':   'The Independent',
  'newvision.co.ug':     'New Vision',
  'monitor.co.ug':       'Daily Monitor',
  'nilepost.co.ug':      'Nile Post',
  'mulengeranews.com':   'Mulengera News',
  'matookerepublic.com': 'Matooke Republic',
  'observer.ug':         'The Observer',
  'howwe.biz':           'Howwe',
  'chimp.net':           'Chimp Reports',
};

// Rough league/competition tagging based on keywords in the headline.
// Order matters - more specific checks first.
const LEAGUE_RULES = [
  { label: '🌍 World Cup',   tag: 'worldcup',   keywords: ['world cup', 'fifa world cup', 'wc 2026'] },
  { label: '🇺🇬 Cranes',     tag: 'uganda',      keywords: ['cranes', 'uganda national team', 'chan'] },
  { label: '🇺🇬 UPL',        tag: 'uganda',      keywords: ['upl', 'startimes uganda premier', 'kcca', 'vipers', 'sc villa', 'express fc', 'uganda premier league'] },
  { label: '🌍 CECAFA',      tag: 'eastafrica',  keywords: ['cecafa', 'east africa'] },
  { label: '🏆 UCL',         tag: 'europe',      keywords: ['champions league', 'ucl'] },
  { label: '🏴󠁧󠁢󠁥󠁮󠁧󠁿 EPL',       tag: 'europe',      keywords: ['premier league', 'arsenal', 'chelsea', 'liverpool', 'man city', 'manchester city', 'manchester united', 'man utd', 'tottenham'] },
  { label: '🇪🇸 La Liga',    tag: 'europe',      keywords: ['la liga', 'real madrid', 'barcelona', 'atletico madrid'] },
  { label: '🇮🇹 Serie A',    tag: 'europe',      keywords: ['serie a', 'juventus', 'ac milan', 'inter milan', 'napoli'] },
  { label: '🇩🇪 Bundesliga', tag: 'europe',      keywords: ['bundesliga', 'bayern munich', 'borussia dortmund'] },
  { label: '🇫🇷 Ligue 1',    tag: 'europe',      keywords: ['ligue 1', 'psg', 'paris saint-germain', 'marseille'] },
];

// Headline must look like a *result* (not a preview/fixture announcement)
// to qualify for the results widget.
const RESULT_KEYWORDS = [
  'beat', 'beats', 'beaten', 'win', 'wins', 'won', 'draw', 'drew', 'held',
  'thrash', 'thrashed', 'rout', 'stun', 'stuns', 'stunned', 'defeat', 'defeated',
  'loses', 'lost', 'lose', 'crush', 'crushed', 'edge', 'edged', 'snatch', 'fall to',
  'fell to', 'victory', 'triumph', 'humiliate', 'humiliated', 'salvage'
];
// A bare scoreline like "2-1" or "3 - 0" in the title is also a strong signal.
const SCORELINE_REGEX = /\b\d\s*-\s*\d\b/;

function getSourceName(url) {
  for (const [domain, name] of Object.entries(SOURCE_NAMES)) {
    if (url.includes(domain)) return name;
  }
  return 'Uganda Sports';
}

function detectLeague(title) {
  const lower = title.toLowerCase();
  for (const rule of LEAGUE_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return { label: rule.label, tag: rule.tag };
    }
  }
  return null; // not confidently a football result we want to tag
}

function looksLikeResult(title) {
  const lower = title.toLowerCase();
  if (SCORELINE_REGEX.test(title)) return true;
  return RESULT_KEYWORDS.some(kw => lower.includes(kw));
}

function parseRSS(xml, sourceName) {
  const articles = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  items.slice(0, 12).forEach(item => {
    const get = (tag) => {
      const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? (m[1] || m[2] || '').trim() : '';
    };

    const title = get('title');
    const link  = get('link') || get('guid');
    const date  = get('pubDate');

    if (title && link) {
      articles.push({
        title,
        url: link,
        source: sourceName,
        publishedAt: date ? new Date(date).toISOString() : new Date().toISOString()
      });
    }
  });

  return articles;
}

exports.handler = async () => {
  try {
    const results = await Promise.allSettled(
      RESULT_FEEDS.map(feedUrl =>
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

    // Keep only headlines that look like match results, and tag them with a league
    let matches = articles
      .filter(a => looksLikeResult(a.title))
      .map(a => {
        const league = detectLeague(a.title) || { label: '⚽ Football', tag: 'other' };
        return { ...a, league: league.label, leagueTag: league.tag };
      });

    // Sort newest first
    matches.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    // Deduplicate by title
    const seen = new Set();
    matches = matches.filter(m => {
      if (seen.has(m.title)) return false;
      seen.add(m.title);
      return true;
    });

    matches = matches.slice(0, 18);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      },
      body: JSON.stringify({ matches, totalResults: matches.length })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ matches: [], error: error.message })
    };
  }
};