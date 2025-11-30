const axios = require('axios');

let cachedRates = null;
let lastFetched = null;

async function fetchRates() {
    const dateNow = Date.now();

    // Refresh cache every hour to respect the API's update frequency
    if (cachedRates && lastFetched && (dateNow - lastFetched < 3600000)) {
        return cachedRates;
    }

    try {
        const baseCurrency = "USD"; 
        // UPDATED: New API endpoint for Frankfurter
        const response = await axios.get(
            `https://api.frankfurter.app/latest?from=${baseCurrency}`
        );

        // UPDATED: Changed from 'conversion_rates' to 'rates' for the new API
        if (!response.data || !response.data.rates) {
            throw new Error("Invalid response from currency API: " + JSON.stringify(response.data));
        }

        cachedRates = response.data.rates;
        // The API provides rates against the base, so we need to add the base currency manually
        cachedRates[baseCurrency] = 1; 
        lastFetched = dateNow;

        return cachedRates;
    } catch (err) {
        console.error("Error fetching currency rates:", err.message);
        // Return the old cache if the new fetch fails, to improve resilience
        return cachedRates || null; 
    }
}

async function convertCurrency(amount, targetCurrency) {
    const rates = await fetchRates();
    if (rates && rates[targetCurrency]) {
        return amount * rates[targetCurrency];
    } else {
        console.error(`Conversion rate for ${targetCurrency} not found.`);
        return amount; // Fallback: return the original amount
    }
}

// NEW: Helper to get the raw rate for inverse calculations (e.g. PHP -> USD)
async function getExchangeRate(targetCurrency) {
    const rates = await fetchRates();
    if (rates && rates[targetCurrency]) {
        return rates[targetCurrency];
    }
    return 1; // Fallback 1:1 if not found
}

module.exports = { convertCurrency, getExchangeRate };