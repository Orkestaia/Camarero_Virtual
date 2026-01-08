
// Diagnostic Script for Gemini Live API
const API_KEY = "AIzaSyCbVKa_AK1zcq6Gr8Q78PetZ1ob_Whjj8Y"; // User provided key (New)
const HOST = "generativelanguage.googleapis.com";
const MODEL = "models/gemini-2.0-flash-exp";
const URL = `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

// Node 21+ has built-in WebSocket, otherwise we need 'ws'
// Since environment is likely Node 18+ but maybe not 21, detection handles it or we fail.
// We'll trust the user environment or provided tools. Assuming Node 22 based on package.json types.

console.log("=== Testing Gemini Live Connection ===");
console.log(`URL: wss://${HOST}/...`);
console.log(`Model: ${MODEL}`);

try {
    const ws = new WebSocket(URL);

    ws.onopen = () => {
        console.log("✅ WebSocket Connected!");

        // Send initial setup message
        const setupMsg = {
            setup: {
                model: MODEL,
                generationConfig: {
                    responseModalities: ["AUDIO"]
                }
            }
        };
        console.log("Sending setup:", JSON.stringify(setupMsg));
        ws.send(JSON.stringify(setupMsg));
    };

    ws.onmessage = (event) => {
        let msg;
        try {
            msg = JSON.parse(event.data);
        } catch (e) {
            msg = event.data;
        }
        console.log("📩 Message received:", typeof msg === 'object' ? JSON.stringify(msg, null, 2).substring(0, 200) + "..." : msg);

        // If we get a server messsage showing it accepted setup, we are good.
        if (msg.serverContent) {
            console.log("✅ Setup accepted. Session is active.");
            ws.close(1000, "Test complete");
        }
    };

    ws.onclose = (event) => {
        console.log(`❌ WebSocket Closed. Code: ${event.code}, Reason: ${event.reason}`);
    };

    ws.onerror = (error) => {
        console.error("❌ WebSocket Error:", error.message || error);
    };

} catch (e) {
    console.error("Critical Error initializing WebSocket:", e);
}
