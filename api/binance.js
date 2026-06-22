// api/binance.js
import CryptoJS from 'crypto-js';

export default async function handler(req, res) {
    // Vercel Settings වල ඔබ ඇතුළත් කළ Keys මෙහිදී භාවිතා වේ
    const apiKey = process.env.VITE_BINANCE_API_KEY;
    const apiSecret = process.env.VITE_BINANCE_SECRET_KEY;

    // Spot Balance බැලීමට අවශ්‍ය නම්: https://api.binance.com/api/v3/account
    // Futures Balance බැලීමට අවශ්‍ය නම්: https://fapi.binance.com/fapi/v2/account
    const endpoint = 'https://api.binance.com/api/v3/account';
    
    const timestamp = Date.now( );
    const queryString = `timestamp=${timestamp}`;
    
    // Binance API එකට අවශ්‍ය රහස් අත්සන (Signature) සෑදීම
    const signature = CryptoJS.HmacSHA256(queryString, apiSecret).toString();

    try {
        const response = await fetch(`${endpoint}?${queryString}&signature=${signature}`, {
            method: 'GET',
            headers: {
                'X-MBX-APIKEY': apiKey,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        // සාර්ථකව දත්ත ලැබුණහොත් එය Frontend එකට යැවීම
        res.status(200).json(data);
    } catch (error) {
        console.error("Binance API Error:", error);
        res.status(500).json({ error: "Failed to fetch data from Binance" });
    }
}
