async function verifyTurnstile(token, ip) {
    const url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'; 
    
    // The request body must include the secret, the response token, and the user's IP[cite: 311, 312, 313].
    const body = new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET,
        response: token,
        remoteip: ip,
    });

    try {
        const response = await fetch(url, {
            method: 'POST',
            body: body,
        });
        const data = await response.json(); 
        return data;
    } catch (error) {
        console.error('Error verifying Turnstile token:', error);
        // Return a standard failure object if the fetch operation fails.
        return { success: false, 'error-codes': ['fetch-failed'] };
    }
}

module.exports = verifyTurnstile;