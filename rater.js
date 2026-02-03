/**
 * Price rating algorithm for house listings.
 *
 * Rates each listing 1-10 based on:
 * - Price per m² relative to the area median
 * - Total price relative to the area median
 * - Having land included
 *
 * A "MUST BUY" label is applied to listings rated 9 or 10.
 */

function rateListings(listings) {
  if (!listings.length) return [];

  // Filter listings with valid price data for statistics
  const withPrice = listings.filter(l => l.price && l.price > 0);
  const withPPS = listings.filter(l => l.pricePerSqm && l.pricePerSqm > 0);

  if (!withPrice.length) {
    return listings.map(l => ({ ...l, rating: 5, label: '', ratingReason: 'No price data available for comparison' }));
  }

  // Calculate median price per sqm across all neighborhoods
  const allPPS = withPPS.map(l => l.pricePerSqm).sort((a, b) => a - b);
  const medianPPS = allPPS.length ? percentile(allPPS, 50) : null;
  const p25PPS = allPPS.length ? percentile(allPPS, 25) : null;
  const p10PPS = allPPS.length ? percentile(allPPS, 10) : null;
  const p75PPS = allPPS.length ? percentile(allPPS, 75) : null;

  // Calculate median total price
  const allPrices = withPrice.map(l => l.price).sort((a, b) => a - b);
  const medianPrice = percentile(allPrices, 50);

  // Calculate per-neighborhood medians for more accurate rating
  const neighborhoodStats = {};
  for (const listing of withPPS) {
    if (!neighborhoodStats[listing.neighborhood]) {
      neighborhoodStats[listing.neighborhood] = [];
    }
    neighborhoodStats[listing.neighborhood].push(listing.pricePerSqm);
  }
  for (const key of Object.keys(neighborhoodStats)) {
    neighborhoodStats[key].sort((a, b) => a - b);
    neighborhoodStats[key] = {
      median: percentile(neighborhoodStats[key], 50),
      p25: percentile(neighborhoodStats[key], 25),
      count: neighborhoodStats[key].length,
    };
  }

  // Rate each listing
  const rated = listings.map(listing => {
    let score = 5; // Default middle score
    const reasons = [];

    if (listing.pricePerSqm && listing.pricePerSqm > 0 && medianPPS) {
      const ratio = listing.pricePerSqm / medianPPS;

      if (ratio <= 0.4) {
        score = 10;
        reasons.push(`€/m² is ${Math.round((1 - ratio) * 100)}% below median`);
      } else if (ratio <= 0.55) {
        score = 9;
        reasons.push(`€/m² is ${Math.round((1 - ratio) * 100)}% below median`);
      } else if (ratio <= 0.7) {
        score = 8;
        reasons.push(`€/m² is ${Math.round((1 - ratio) * 100)}% below median`);
      } else if (ratio <= 0.85) {
        score = 7;
        reasons.push(`€/m² well below median`);
      } else if (ratio <= 1.0) {
        score = 6;
        reasons.push(`€/m² slightly below median`);
      } else if (ratio <= 1.15) {
        score = 5;
        reasons.push(`€/m² near median`);
      } else if (ratio <= 1.3) {
        score = 4;
        reasons.push(`€/m² above median`);
      } else if (ratio <= 1.5) {
        score = 3;
        reasons.push(`€/m² well above median`);
      } else if (ratio <= 1.8) {
        score = 2;
        reasons.push(`€/m² significantly above median`);
      } else {
        score = 1;
        reasons.push(`€/m² far above median`);
      }

      // Bonus: compare to neighborhood median
      const nStats = neighborhoodStats[listing.neighborhood];
      if (nStats && nStats.median) {
        const nRatio = listing.pricePerSqm / nStats.median;
        if (nRatio <= 0.6) {
          score = Math.min(10, score + 1);
          reasons.push(`Best price in ${listing.neighborhood}`);
        }
      }
    } else if (listing.price && medianPrice) {
      // Fallback: rate by total price only
      const ratio = listing.price / medianPrice;
      if (ratio <= 0.5) score = 8;
      else if (ratio <= 0.75) score = 7;
      else if (ratio <= 1.0) score = 6;
      else if (ratio <= 1.25) score = 5;
      else if (ratio <= 1.5) score = 4;
      else score = 3;
      reasons.push('Rated by total price (no m² data)');
    } else {
      reasons.push('Insufficient price data');
    }

    // Bonus for having large land
    if (listing.landSqm && listing.landSqm > 500 && listing.price) {
      const landPriceRatio = listing.price / listing.landSqm;
      if (landPriceRatio < 100) {
        score = Math.min(10, score + 1);
        reasons.push('Large land at low price');
      }
    }

    score = Math.max(1, Math.min(10, score));

    const label = score >= 9 ? 'MUST BUY' : '';

    return {
      ...listing,
      rating: score,
      label,
      ratingReason: reasons.join('. '),
      medianPPS: Math.round(medianPPS || 0),
    };
  });

  // Sort by rating descending, then by price per sqm ascending
  rated.sort((a, b) => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (a.pricePerSqm && b.pricePerSqm) return a.pricePerSqm - b.pricePerSqm;
    if (a.price && b.price) return a.price - b.price;
    return 0;
  });

  return rated;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

module.exports = { rateListings };
