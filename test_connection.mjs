
// Native fetch in Node 18+

const N8N_URL = "https://acgrowthmarketing.app.n8n.cloud/webhook/9d2ccd81-7b77-4538-8f98-00fa0469331e";
const ORDERS_CSV_URL = `https://docs.google.com/spreadsheets/d/e/2PACX-1vQ0ZEi4qlGwZ3g8dFBGjNTUynory53ETAqGNQ-WS4vjv_-ENfFRTZOOc4yI9ZcHiD9BICAPkQwiQgz6/pub?output=csv`;

async function testN8N() {
    console.log("Testing N8N Webhook...");
    try {
        const res = await fetch(N8N_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ test: true, message: "Debug from Patxi" })
        });
        console.log(`N8N Status: ${res.status} ${res.statusText}`);
        const text = await res.text();
        console.log(`N8N Response: ${text}`);
    } catch (error) {
        console.error("N8N Error:", error);
    }
}

async function testCSV() {
    console.log("\nTesting Orders CSV...");
    try {
        const res = await fetch(ORDERS_CSV_URL);
        console.log(`CSV Status: ${res.status}`);
        const text = await res.text();
        const lines = text.split('\n');
        console.log(`CSV Headers: ${lines[0]}`);
        console.log(`CSV First Row: ${lines[1] || 'No data'}`);
    } catch (error) {
        console.error("CSV Error:", error);
    }
}

async function run() {
    await testN8N();
    await testCSV();
}

run();
