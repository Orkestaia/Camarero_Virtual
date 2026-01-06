
import { fetchMenuFromSheets } from './api';

async function test() {
    console.log("Fetching menu...");
    try {
        const menu = await fetchMenuFromSheets();
        console.log(`Fetched ${menu.length} items.`);

        if (menu.length > 0) {
            console.log("First 3 items:");
            console.log(JSON.stringify(menu.slice(0, 3), null, 2));

            console.log("\nChecking for specific items:");
            const rabas = menu.find(m => m.name.toLowerCase().includes('rabas'));
            console.log("Rabas found:", rabas ? rabas.name : "NO");
        } else {
            console.error("MENU IS EMPTY!");
        }
    } catch (e) {
        console.error("Error fetching menu:", e);
    }
}

test();
