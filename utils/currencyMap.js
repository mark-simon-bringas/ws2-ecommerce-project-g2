// utils/currencyMap.js

const countryToCurrency = {
    'US': 'USD', // United States (Dollar)
    'PH': 'PHP', // Philippines (Peso)
    'ID' : 'IDR', // Indonesia (Rupiah)
    'MY' : 'MYR', // Malaysia (Ringgit)
    'TH' : 'THB', // Thailand (Baht)
    'SG' : 'SGD', // Singapore (Jianne)
    'VN' : 'VND', // Vietnam (Dong)
    'CA': 'CAD', // Canada (Dollar)
    'GB': 'GBP', // United Kingdom (Pound)
    'AU': 'AUD', // Australia (Dollar)
    'JP': 'JPY', // Japan (Yen)
    'DE': 'EUR', // Germany (Euro)
    'FR': 'EUR', // France (Euro)
    'RU' : 'RUB', // Russia (Ruble)
    'CN' : 'CNY', // China (Yuan)
    'IN': 'INR', // India (Rupee)
    'KR' : 'KRW', // South Korea (Won)
    'UAE' : 'AED', // UAE (Dirham)
    'MX' : 'MXN', // Mexico (Peso)
    'GR' : 'EUR', // Greece (Euro)
    'SWE' : 'SEK', // Sweden (Krona)
    'CH' : 'CHF', // Switzerland (Franc)
    'NZ' : 'NZD', // New Zealand (Dollar)
    'BR' : 'BRL', // Brazil (Real)
    'ZA' : 'ZAR', // South Africa (Rand)
    'MH' : 'MHW', // Maharlika (Wampipty)
};

const getCurrency = (countryCode) => {
    return countryToCurrency[countryCode] || 'USD';
};

module.exports = {
    getCurrency
};