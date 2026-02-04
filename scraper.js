const fetch = require('node-fetch');
const cheerio = require('cheerio');

const BASE_URL = 'https://www.halooglasi.com';

const NEIGHBORHOODS = [
  { name: 'Leštane', slug: 'beograd-grocka-lestane' },
  { name: 'Boleč', slug: 'beograd-grocka-bolec' },
  { name: 'Vinča', slug: 'beograd-grocka-vinca' },
  { name: 'Kaluđerica', slug: 'beograd-grocka-kaludjerica' },
  { name: 'Grocka', slug: 'beograd-grocka' },
  { name: 'Voždovac', slug: 'beograd-vozdovac' },
  { name: 'Barajevo', slug: 'beograd-barajevo' },
  { name: 'Zvezdara', slug: 'beograd-zvezdara' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'sr-RS,sr;q=0.9,en;q=0.8',
};

function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/\./g, '').replace(/,/g, '.').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseSqm(text) {
  if (!text) return null;
  const match = text.replace(/\s/g, '').match(/([\d.,]+)/);
  if (!match) return null;
  return parseFloat(match[1].replace(',', '.'));
}

function parsePricePerSqm(text) {
  if (!text) return null;
  const match = text.replace(/\s/g, '').match(/([\d.,]+)/);
  if (!match) return null;
  return parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, timeout: 15000 });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.error(`Failed to fetch ${url}:`, err.message);
    return null;
  }
}

function parseListings(html, neighborhood) {
  const $ = cheerio.load(html);
  const listings = [];

  $('.product-item.product-list-item').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('data-id') || $el.attr('id') || '';

    // Title & link
    const $title = $el.find('.product-title a');
    const title = $title.text().trim();
    const relLink = $title.attr('href') || '';
    const link = relLink ? `${BASE_URL}${relLink}` : '';

    // Price
    const priceRaw = $el.find('.central-feature span').attr('data-value');
    const price = parsePrice(priceRaw);

    // Price per m²
    const ppsText = $el.find('.price-by-surface span').text();
    const pricePerSqm = parsePricePerSqm(ppsText);

    // Image
    const imgSrc = $el.find('.pi-img-wrapper img').attr('src') || '';
    const imgCount = parseInt($el.find('.pi-img-count-num').text()) || 0;

    // Location
    const locationParts = [];
    $el.find('.subtitle-places li').each((_, li) => {
      const t = $(li).text().replace(/\u00a0/g, '').trim();
      if (t) locationParts.push(t);
    });
    const location = locationParts.join(', ');

    // Features (sqm, rooms, land, etc.)
    let sqm = null;
    let landSqm = null;
    let rooms = null;
    $el.find('.product-features .value-wrapper').each((_, fw) => {
      const text = $(fw).text().trim();
      const legend = $(fw).find('.legend').text().trim().toLowerCase();
      const valueText = text.replace($(fw).find('.legend').text(), '').trim();

      if (legend.includes('kvadratura') || legend.includes('površina')) {
        sqm = parseSqm(valueText);
      } else if (legend.includes('zemljište') || legend.includes('plac')) {
        landSqm = parseSqm(valueText);
      } else if (legend.includes('soba') || legend.includes('sob')) {
        rooms = valueText;
      }
    });

    // Calculate price per sqm if not provided
    let calculatedPPS = pricePerSqm;
    if (!calculatedPPS && price && sqm && sqm > 0) {
      calculatedPPS = Math.round(price / sqm);
    }

    if (title || price) {
      listings.push({
        id,
        title,
        link,
        price,
        pricePerSqm: calculatedPPS,
        sqm,
        landSqm,
        rooms,
        image: imgSrc,
        imgCount,
        location,
        neighborhood: neighborhood.name,
        slug: neighborhood.slug,
      });
    }
  });

  return listings;
}

function getTotalPages(html) {
  // Try to extract from embedded JSON data (e.g. "TotalPages":8)
  const jsonMatch = html.match(/"TotalPages"\s*:\s*(\d+)/);
  if (jsonMatch) {
    return parseInt(jsonMatch[1]);
  }

  // Fallback: look for page links in HTML
  const $ = cheerio.load(html);
  let maxPage = 1;
  $('a[href*="page="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/page=(\d+)/);
    if (match) {
      const p = parseInt(match[1]);
      if (p > maxPage) maxPage = p;
    }
  });

  // Also check for pagination buttons/spans with numbers
  $('.page-number, .pagination a, .paging a').each((_, el) => {
    const text = $(el).text().trim();
    const num = parseInt(text);
    if (!isNaN(num) && num > maxPage) maxPage = num;
  });

  return maxPage;
}

async function scrapeNeighborhood(neighborhood) {
  const url = `${BASE_URL}/nekretnine/prodaja-kuca/${neighborhood.slug}`;
  console.log(`Scraping ${neighborhood.name}: ${url}`);

  const firstPageHtml = await fetchPage(url);
  if (!firstPageHtml) return [];

  let allListings = parseListings(firstPageHtml, neighborhood);
  const totalPages = getTotalPages(firstPageHtml);

  for (let page = 2; page <= totalPages; page++) {
    const pageUrl = `${url}?page=${page}`;
    console.log(`  Page ${page}/${totalPages}: ${pageUrl}`);
    const html = await fetchPage(pageUrl);
    if (html) {
      const pageListings = parseListings(html, neighborhood);
      allListings = allListings.concat(pageListings);
    }
    // Small delay between pages to be respectful
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`  Found ${allListings.length} listings in ${neighborhood.name}`);
  return allListings;
}

function deduplicate(listings) {
  const seen = new Set();
  return listings.filter(l => {
    if (!l.id || seen.has(l.id)) return false;
    seen.add(l.id);
    return true;
  });
}

async function scrapeAll(onProgress) {
  let allListings = [];

  for (let i = 0; i < NEIGHBORHOODS.length; i++) {
    const neighborhood = NEIGHBORHOODS[i];
    const listings = await scrapeNeighborhood(neighborhood);
    allListings = allListings.concat(listings);

    const unique = deduplicate([...allListings]);
    if (onProgress) {
      onProgress({
        current: i + 1,
        total: NEIGHBORHOODS.length,
        currentName: neighborhood.name,
        listings: unique,
      });
    }

    if (i < NEIGHBORHOODS.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  allListings = deduplicate(allListings);
  console.log(`Total unique listings: ${allListings.length}`);
  return allListings;
}

module.exports = { scrapeAll, NEIGHBORHOODS };
