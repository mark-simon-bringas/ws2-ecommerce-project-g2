const axios = require('axios');

let cachedRates = null;
let lastFetched = null;

async function fetchRates() {
    const dateNow = Date.now();

    // Refresh cache every hour
    if (cachedRates && lastFetched && (dateNow - lastFetched < 3600000)) {
        return cachedRates;
    }

    try {
        const baseCurrency = "USD"; // USD 
        const response = await axios.get(
            `https://v6.exchangerate-api.com/v6/${process.env.CURRENCY_API_KEY}/latest/${baseCurrency}`
        );

        if (!response.data || !response.data.conversion_rates) {
            throw new Error("Invalid response from currency API: " + JSON.stringify(response.data));
        }

        cachedRates = response.data.conversion_rates;
        lastFetched = dateNow;

        return cachedRates;
    } catch (err) {
        console.error("Error fetching currency rates:", err.message);
        return null;
    }
}

async function convertCurrency(amount, targetCurrency) {
    const rates = await fetchRates();
    if (rates && rates[targetCurrency]) {
        return amount * rates[targetCurrency];
    } else {
        console.error(`Conversion rate for ${targetCurrency} not found.`);
        return amount; // Fallback: return the original amount in dollars mayt
    }
}

module.exports = { convertCurrency };