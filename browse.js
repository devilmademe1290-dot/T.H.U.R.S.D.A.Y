const { chromium } = require('playwright');

async function browse() {
  const url = process.argv[2];
  
  try {
    // headless: false ensures the browser window is visible to you
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    await page.goto(url);
    console.log(`Success: Browsing ${url}`);
    
    // We intentionally leave the browser open for you to view
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

browse();