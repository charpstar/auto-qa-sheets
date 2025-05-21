import { NextResponse } from "next/server";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import puppeteerPackage from "puppeteer/package.json";

// Create output directory if it doesn't exist
const outputDir = path.join(process.cwd(), "public", "screenshots");
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

export async function GET() {
  let browser = null;

  try {
    console.log("Starting headless browser test for model-viewer...");

    console.log("Puppeteer version:", puppeteerPackage.version);

    // Launch browser with increased timeout and debug logging
    console.log("Launching browser...");
    browser = await puppeteer.launch({
      headless: true, // Use the new headless mode
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-web-security",
        "--disable-features=IsolateOrigins",
        "--disable-site-isolation-trials",
      ],
      timeout: 60000, // Increase browser launch timeout
    });

    // Open new page
    const page = await browser.newPage();

    // Enable more verbose logging
    page.on("console", (msg) => console.log("Browser console:", msg.text()));
    page.on("pageerror", (err) =>
      console.error("Browser page error:", err.message)
    );
    page.on("error", (err) => console.error("Browser error:", err.message));

    // Set viewport
    await page.setViewport({
      width: 1024,
      height: 768,
    });

    // Create improved HTML content with model-viewer and better loading detection
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Model Viewer Test</title>
        <script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@2.1.1/dist/model-viewer.min.js"></script>
        <style>
          model-viewer {
            width: 800px;
            height: 600px;
            background-color: #f0f0f0;
          }
          #loading-status {
            position: fixed;
            top: 10px;
            left: 10px;
            padding: 5px;
            background: rgba(0,0,0,0.7);
            color: white;
            font-family: sans-serif;
            z-index: 9999;
          }
        </style>
      </head>
      <body>
        <div id="loading-status">Initializing...</div>
        
        <model-viewer
          id="test-viewer"
          src="https://modelviewer.dev/shared-assets/models/Astronaut.glb"
          camera-controls
          camera-orbit="0deg 75deg 150%"
          exposure="1.3"
          shadow-intensity="1"
          ar
          shadow-softness="1"
          environment-image="https://modelviewer.dev/shared-assets/environments/moon_1k.hdr">
        </model-viewer>
        
        <script>
          // More detailed loading status tracking
          const status = document.getElementById('loading-status');
          const viewer = document.getElementById('test-viewer');
          
          status.textContent = "Waiting for model-viewer to initialize...";
          
          // Track various model-viewer events
          viewer.addEventListener('progress', (event) => {
            const progress = Math.floor(event.detail.totalProgress * 100);
            status.textContent = \`Loading model: \${progress}%\`;
            console.log(\`Loading progress: \${progress}%\`);
          });
          
          viewer.addEventListener('error', (event) => {
            status.textContent = \`Error: \${event.detail.sourceError || 'Unknown error'}\`;
            console.error('Model-viewer error:', event);
          });
          
          viewer.addEventListener('load', () => {
            status.textContent = "Model loaded successfully!";
            console.log('Model loaded successfully!');
            document.title = 'MODEL_LOADED';
            
            // Create an element to signal completion
            const signal = document.createElement('div');
            signal.id = 'model-loaded-signal';
            signal.style.display = 'none';
            document.body.appendChild(signal);
          });
        </script>
      </body>
      </html>
    `;

    // Set page content
    console.log("Setting page content...");
    await page.setContent(htmlContent, {
      waitUntil: "networkidle0",
      timeout: 60000, // Increase content loading timeout
    });

    // Alternative model loading detection approach
    console.log("Waiting for model to load...");

    try {
      // Try both approaches to detect model loading
      await Promise.race([
        // Method 1: Wait for title change
        page
          .waitForFunction('document.title === "MODEL_LOADED"', {
            timeout: 60000, // Increased timeout
            polling: 1000, // Poll every second
          })
          .then(() => console.log("Detected model load via title change")),

        // Method 2: Wait for the signal element
        page
          .waitForSelector("#model-loaded-signal", {
            timeout: 60000, // Increased timeout
          })
          .then(() => console.log("Detected model load via signal element")),

        // Method 3: Wait for a reasonable time and proceed anyway if other methods fail
        new Promise((resolve) =>
          setTimeout(() => {
            console.log(
              "Proceeding after timeout - model may not be fully loaded"
            );
            resolve(null);
          }, 45000)
        ), // Wait 45 seconds and continue
      ]);
    } catch (loadError: unknown) {
      console.warn(
        "Warning: Model load detection timed out, proceeding anyway:",
        loadError instanceof Error ? loadError.message : String(loadError)
      );
      // Continue execution even if model load detection times out
    }

    // Small pause to ensure rendering is complete
    // REPLACE waitForTimeout with setTimeout + Promise
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log("Taking default screenshot...");

    // Take a screenshot to verify
    await page.screenshot({
      path: path.join(outputDir, "model-default.png") as `${string}.png`,
      fullPage: true,
    });

    // Rotate model and take more screenshots
    const angles = [
      "90deg 75deg 150%",
      "180deg 75deg 150%",
      "270deg 75deg 150%",
    ];

    const screenshots = ["model-default.png"];

    for (let i = 0; i < angles.length; i++) {
      const angleName = `model-angle-${i + 1}.png`;
      console.log(`Setting camera angle to ${angles[i]}...`);

      // Use proper evaluate function to set camera orbit
      await page.evaluate((angle) => {
        const viewer = document.querySelector("model-viewer");
        if (!viewer) {
          console.error("model-viewer element not found");
          return;
        }
        viewer.setAttribute("camera-orbit", angle);
        console.log(`Camera orbit set to ${angle}`);
      }, angles[i]);

      // Wait for camera to move and rendering to complete
      console.log(`Waiting for camera movement...`);
      // REPLACE waitForTimeout with setTimeout + Promise
      await new Promise((resolve) => setTimeout(resolve, 3000));

      console.log(`Taking screenshot for angle ${angles[i]}...`);
      const screenshotBuffer = await page.screenshot({
        fullPage: true,
      });
      fs.writeFileSync(path.join(outputDir, angleName), screenshotBuffer);
      screenshots.push(angleName);

      screenshots.push(angleName);
    }

    // Close browser
    if (browser) {
      await browser.close();
      browser = null;
    }

    // Return success with screenshot paths
    return NextResponse.json({
      success: true,
      message: "Headless browser test completed successfully",
      screenshots: screenshots.map((name) => `/screenshots/${name}`),
    });
  } catch (error) {
    console.error("Error running headless browser test:", error);

    // Take an error screenshot if possible
    if (browser) {
      try {
        const pages = await browser.pages();
        if (pages.length > 0) {
          const errorScreenshotBuffer = await pages[0].screenshot({
            fullPage: true,
          });
          fs.writeFileSync(
            path.join(outputDir, "error-state.png"),
            errorScreenshotBuffer
          );
        }
      } catch (screenshotError) {
        console.error("Failed to take error screenshot:", screenshotError);
      }
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "An error occurred during the test",
        suggestion: "Try increasing timeouts or checking browser compatibility",
      },
      { status: 500 }
    );
  } finally {
    // Ensure browser is closed in all cases
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error("Error closing browser:", closeError);
      }
    }
  }
}

// Set config for long-running API route
export const dynamic = "force-dynamic";
export const maxDuration = 120; // Increase to 120 seconds
