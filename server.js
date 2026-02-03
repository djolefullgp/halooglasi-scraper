const express = require('express');
const path = require('path');
const { scrapeAll, NEIGHBORHOODS } = require('./scraper');
const { rateListings } = require('./rater');

const app = express();
const PORT = process.env.PORT || 3000;

// State
let listings = [];
let lastScrapeTime = null;
let scraping = false;
let knownIds = new Set();
let newIds = new Set();
let scrapeCount = 0;
let scrapeProgress = { current: 0, total: NEIGHBORHOODS.length, currentName: '' };

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));

// API: Get current listings
app.get('/api/listings', (req, res) => {
  res.json({
    listings,
    lastScrapeTime,
    scraping,
    scrapeCount,
    scrapeProgress,
    newIds: Array.from(newIds),
    stats: getStats(),
  });
});

// API: Force a fresh scrape
app.get('/api/scrape', async (req, res) => {
  if (scraping) {
    return res.json({ status: 'already_scraping' });
  }
  runScrape();
  res.json({ status: 'started' });
});

function getStats() {
  const withPrice = listings.filter(l => l.price > 0);
  const withPPS = listings.filter(l => l.pricePerSqm > 0);
  const byNeighborhood = {};

  for (const l of listings) {
    if (!byNeighborhood[l.neighborhood]) {
      byNeighborhood[l.neighborhood] = { count: 0, avgPPS: 0, prices: [] };
    }
    byNeighborhood[l.neighborhood].count++;
    if (l.pricePerSqm) {
      byNeighborhood[l.neighborhood].prices.push(l.pricePerSqm);
    }
  }

  for (const key of Object.keys(byNeighborhood)) {
    const prices = byNeighborhood[key].prices;
    byNeighborhood[key].avgPPS = prices.length
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : 0;
    delete byNeighborhood[key].prices;
  }

  return {
    total: listings.length,
    withPrice: withPrice.length,
    withPPS: withPPS.length,
    mustBuy: listings.filter(l => l.label === 'MUST BUY').length,
    byNeighborhood,
    medianPPS: listings.length ? listings[0].medianPPS : 0,
  };
}

async function runScrape() {
  if (scraping) return;
  scraping = true;
  scrapeProgress = { current: 0, total: NEIGHBORHOODS.length, currentName: NEIGHBORHOODS[0].name };
  console.log(`\n--- Scrape #${scrapeCount + 1} started at ${new Date().toLocaleTimeString()} ---`);

  try {
    const raw = await scrapeAll((progress) => {
      scrapeProgress = {
        current: progress.current,
        total: progress.total,
        currentName: progress.currentName,
      };

      // Update listings incrementally so frontend shows partial results
      const rated = rateListings(progress.listings);
      listings = rated;
      console.log(`  Progress: ${progress.current}/${progress.total} (${progress.currentName}) - ${rated.length} listings so far`);
    });

    const rated = rateListings(raw);

    // Detect new listings
    newIds = new Set();
    for (const l of rated) {
      if (l.id && !knownIds.has(l.id)) {
        newIds.add(l.id);
        knownIds.add(l.id);
      }
    }

    listings = rated;
    lastScrapeTime = new Date().toISOString();
    scrapeCount++;

    if (newIds.size > 0) {
      console.log(`  NEW LISTINGS FOUND: ${newIds.size}`);
    }
    console.log(`--- Scrape complete: ${listings.length} listings ---\n`);
  } catch (err) {
    console.error('Scrape failed:', err);
  } finally {
    scraping = false;
    scrapeProgress = { current: 0, total: NEIGHBORHOODS.length, currentName: '' };
  }
}

// Auto-refresh: scrape every 5 minutes
const REFRESH_INTERVAL = 5 * 60 * 1000;

app.listen(PORT, () => {
  console.log(`\nHaloOglasi House Scraper running at http://localhost:${PORT}`);
  console.log(`Monitoring: ${NEIGHBORHOODS.map(n => n.name).join(', ')}`);
  console.log(`Auto-refresh every ${REFRESH_INTERVAL / 60000} minutes\n`);

  // Initial scrape (non-blocking so server responds immediately)
  runScrape();

  // Schedule auto-refresh
  setInterval(() => {
    runScrape();
  }, REFRESH_INTERVAL);
});
