const countryData = {
    'US': { name: 'United States ($)', currency: 'USD', symbol: '$' },
    'PH': { name: 'Philippines (₱)', currency: 'PHP', symbol: '₱' },
    'ID': { name: 'Indonesia (Rp)', currency: 'IDR', symbol: 'Rp' },
    'MY': { name: 'Malaysia (RM)', currency: 'MYR', symbol: 'RM' },
    'TH': { name: 'Thailand (฿)', currency: 'THB', symbol: '฿' },
    'SG': { name: 'Singapore (S$)', currency: 'SGD', symbol: 'S$' },
    'VN': { name: 'Vietnam (₫)', currency: 'VND', symbol: '₫' },
    'CA': { name: 'Canada (C$)', currency: 'CAD', symbol: 'C$' },
    'GB': { name: 'United Kingdom (£)', currency: 'GBP', symbol: '£' },
    'AU': { name: 'Australia (A$)', currency: 'AUD', symbol: 'A$' },
    'JP': { name: 'Japan (¥)', currency: 'JPY', symbol: '¥' },
    'DE': { name: 'Germany (€)', currency: 'EUR', symbol: '€' },
    'FR': { name: 'France (€)', currency: 'EUR', symbol: '€' },
    'RU': { name: 'Russia (₽)', currency: 'RUB', symbol: '₽' },
    'CN': { name: 'China (¥)', currency: 'CNY', symbol: '¥' },
    'IN': { name: 'India (₹)', currency: 'INR', symbol: '₹' },
    'KR': { name: 'South Korea (₩)', currency: 'KRW', symbol: '₩' },
    'UAE': { name: 'United Arab Emirates (د.إ)', currency: 'AED', symbol: 'د.إ' },
    'MX': { name: 'Mexico (MEX$)', currency: 'MXN', symbol: 'MEX$' },
    'GR': { name: 'Greece (€)', currency: 'EUR', symbol: '€' },
    'SWE': { name: 'Sweden (kr)', currency: 'SEK', symbol: 'kr' },
    'CH': { name: 'Switzerland (Fr)', currency: 'CHF', symbol: 'Fr' },
    'NZ': { name: 'New Zealand (NZ$)', currency: 'NZD', symbol: 'NZ$' },
    'BR': { name: 'Brazil (R$)', currency: 'BRL', symbol: 'R$' },
    'ZA': { name: 'South Africa (R)', currency: 'ZAR', symbol: 'R' },
};

// Updated helper function to get the full country data object
const getCountryData = (countryCode) => {
    return countryData[countryCode] || countryData['US']; // Default to US data
};

module.exports = {
    getCountryData,
    countryData 
};