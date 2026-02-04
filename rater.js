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
    const pros = [];
    const cons = [];
    let mainReason = '';

    if (listing.pricePerSqm && listing.pricePerSqm > 0 && medianPPS) {
      const ratio = listing.pricePerSqm / medianPPS;
      const pctDiff = Math.round(Math.abs(1 - ratio) * 100);

      if (ratio <= 0.4) {
        score = 10;
        mainReason = `Izuzetna cena: ${listing.pricePerSqm} €/m² je ${pctDiff}% ispod medijane (${Math.round(medianPPS)} €/m²)`;
        pros.push(`Cena po m² daleko ispod proseka`);
      } else if (ratio <= 0.55) {
        score = 9;
        mainReason = `Odlicna cena: ${listing.pricePerSqm} €/m² je ${pctDiff}% ispod medijane (${Math.round(medianPPS)} €/m²)`;
        pros.push(`Cena po m² znatno ispod proseka`);
      } else if (ratio <= 0.7) {
        score = 8;
        mainReason = `Vrlo dobra cena: ${listing.pricePerSqm} €/m² je ${pctDiff}% ispod medijane (${Math.round(medianPPS)} €/m²)`;
        pros.push(`Cena po m² znatno niza od proseka`);
      } else if (ratio <= 0.85) {
        score = 7;
        mainReason = `Dobra cena: ${listing.pricePerSqm} €/m² je ${pctDiff}% ispod medijane (${Math.round(medianPPS)} €/m²)`;
        pros.push(`Cena po m² ispod proseka`);
      } else if (ratio <= 1.0) {
        score = 6;
        mainReason = `Solidna cena: ${listing.pricePerSqm} €/m² je blizu medijane (${Math.round(medianPPS)} €/m²)`;
        pros.push(`Cena blizu ili malo ispod proseka`);
      } else if (ratio <= 1.15) {
        score = 5;
        mainReason = `Prosecna cena: ${listing.pricePerSqm} €/m² je blizu medijane (${Math.round(medianPPS)} €/m²)`;
        cons.push(`Cena po m² na nivou proseka - nema ustede`);
      } else if (ratio <= 1.3) {
        score = 4;
        mainReason = `Iznadprosecna cena: ${listing.pricePerSqm} €/m² je ${pctDiff}% iznad medijane (${Math.round(medianPPS)} €/m²)`;
        cons.push(`Cena po m² iznad proseka za ${pctDiff}%`);
      } else if (ratio <= 1.5) {
        score = 3;
        mainReason = `Skupa: ${listing.pricePerSqm} €/m² je ${pctDiff}% iznad medijane (${Math.round(medianPPS)} €/m²)`;
        cons.push(`Cena po m² znatno iznad proseka`);
      } else if (ratio <= 1.8) {
        score = 2;
        mainReason = `Vrlo skupa: ${listing.pricePerSqm} €/m² je ${pctDiff}% iznad medijane (${Math.round(medianPPS)} €/m²)`;
        cons.push(`Cena po m² mnogo iznad proseka`);
      } else {
        score = 1;
        mainReason = `Preskupa: ${listing.pricePerSqm} €/m² je ${pctDiff}% iznad medijane (${Math.round(medianPPS)} €/m²)`;
        cons.push(`Cena po m² daleko iznad proseka`);
      }

      // Bonus: compare to neighborhood median
      const nStats = neighborhoodStats[listing.neighborhood];
      if (nStats && nStats.median) {
        const nRatio = listing.pricePerSqm / nStats.median;
        if (nRatio <= 0.6) {
          score = Math.min(10, score + 1);
          pros.push(`Najbolja cena u ${listing.neighborhood} (prosek: ${Math.round(nStats.median)} €/m²)`);
        } else if (nRatio <= 0.85) {
          pros.push(`Ispod proseka za ${listing.neighborhood} (${Math.round(nStats.median)} €/m²)`);
        } else if (nRatio > 1.2) {
          cons.push(`Iznad proseka za ${listing.neighborhood} (${Math.round(nStats.median)} €/m²)`);
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
      mainReason = `Ocenjeno po ukupnoj ceni (${listing.price.toLocaleString('de-DE')} €) - nema podataka o kvadraturi`;
      cons.push('Nema podataka o ceni po m² za preciznije poredjenje');
    } else {
      mainReason = 'Nedovoljno podataka o ceni za ocenu';
      cons.push('Nema dovoljno podataka za poredjenje');
    }

    // Bonus for having large land
    if (listing.landSqm && listing.landSqm > 500 && listing.price) {
      const landPriceRatio = listing.price / listing.landSqm;
      if (landPriceRatio < 100) {
        score = Math.min(10, score + 1);
        pros.push(`Veliki plac (${listing.landSqm} m²) po niskoj ceni (${Math.round(landPriceRatio)} €/m² zemljista)`);
      } else if (listing.landSqm > 800) {
        pros.push(`Veliki plac od ${listing.landSqm} m²`);
      }
    } else if (listing.landSqm && listing.landSqm > 800) {
      pros.push(`Veliki plac od ${listing.landSqm} m²`);
    }

    // Additional context
    if (listing.sqm && listing.sqm > 150) {
      pros.push(`Velika kuca (${listing.sqm} m²)`);
    } else if (listing.sqm && listing.sqm < 50) {
      cons.push(`Mala kuca (${listing.sqm} m²)`);
    }

    if (listing.price && listing.price < 30000) {
      pros.push(`Niska ukupna cena (${listing.price.toLocaleString('de-DE')} €)`);
    } else if (listing.price && listing.price > 200000) {
      cons.push(`Visoka ukupna cena (${listing.price.toLocaleString('de-DE')} €)`);
    }

    score = Math.max(1, Math.min(10, score));

    const label = score >= 9 ? 'MUST BUY' : '';

    return {
      ...listing,
      rating: score,
      label,
      ratingReason: mainReason,
      ratingPros: pros,
      ratingCons: cons,
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
