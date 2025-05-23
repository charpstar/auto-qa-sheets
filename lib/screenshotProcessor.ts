// lib/screenshotProcessor.ts

import puppeteer from "puppeteer";
import { put } from "@vercel/blob";
import { QAJob } from "./queue";

const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export interface ScreenshotResult {
  screenshots: string[];
  processingLogs: string[];
}

export class ScreenshotProcessor {
  // Download GLB file from your existing API
  private async downloadGLB(articleId: string): Promise<Buffer> {
    // Use full URL for server-side requests
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_BASE_URL
      ? process.env.NEXT_PUBLIC_BASE_URL
      : "http://localhost:3000";

    const url = `${baseUrl}/api/download-glb`;

    console.log(`📥 Downloading GLB from: ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ articleId }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to download GLB for article ${articleId}: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Convert GLB buffer to data URL for model-viewer
  private glbBufferToDataURL(buffer: Buffer): string {
    const base64 = buffer.toString("base64");
    return `data:model/gltf-binary;base64,${base64}`;
  }

  // Generate HTML for model-viewer with different camera angles
  private generateModelViewerHTML(
    glbDataURL: string,
    cameraAngle: string
  ): string {
    const cameraSettings = {
      front: 'camera-orbit="0deg 909deg 150%"',
      back: 'camera-orbit="90deg 90deg 150%"',
      left: 'camera-orbit="180deg 90deg 150%"',
      right: 'camera-orbit="270deg 90deg 150%"',
      top: 'camera-orbit="0deg 0deg 150%"',
      isometric: 'camera-orbit="45deg 55deg 150%"',
    };

    return `
      <html>
        <head>
          <script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
          <style>
            body { 
              margin: 0; 
              background: #f5f5f5;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
            }
            model-viewer {
              width: 800px;
              height: 600px;
              background-color: white;
              border-radius: 8px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.1);
            }
          </style>
        </head>
        <body>
          <model-viewer
            src="${glbDataURL}"
            ${
              cameraSettings[cameraAngle as keyof typeof cameraSettings] ||
              cameraSettings.front
            }
            auto-rotate="false"
            camera-controls="false"
            disable-zoom="true"
            exposure="1"
            shadow-intensity="1"
            alt="3D model screenshot"
            loading="eager"
          ></model-viewer>
        </body>
      </html>
    `;
  }

  // Take a single screenshot from a specific angle
  private async takeScreenshot(
    browser: any,
    glbDataURL: string,
    angle: string,
    articleId: string
  ): Promise<string> {
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 800, height: 600 });

      const htmlContent = this.generateModelViewerHTML(glbDataURL, angle);
      await page.setContent(htmlContent, { waitUntil: "networkidle0" });

      // Wait for model-viewer to load and render
      await page.waitForSelector("model-viewer", { timeout: 30000 });

      // Additional wait for model to fully load
      await page.evaluate(() => {
        return new Promise((resolve) => {
          const modelViewer = document.querySelector("model-viewer") as any;
          if (modelViewer) {
            if (modelViewer.modelIsVisible) {
              resolve(true);
            } else {
              modelViewer.addEventListener("load", () => resolve(true));
            }
          } else {
            setTimeout(() => resolve(true), 3000);
          }
        });
      });

      // Take screenshot
      const screenshotBuffer = await page.screenshot({
        type: "png",
        fullPage: false,
      });

      if (!screenshotBuffer) {
        throw new Error(`Screenshot capture failed for angle: ${angle}`);
      }

      // Upload to Vercel Blob
      const filename = `qa-screenshot-${articleId}-${angle}-${generateId()}.png`;
      const { url } = await put(filename, screenshotBuffer as Buffer, {
        access: "public",
        contentType: "image/png",
      });

      console.log(`✅ Screenshot uploaded: ${angle} - ${url}`);
      return url;
    } finally {
      await page.close();
    }
  }

  // Main processing function
  async processScreenshots(job: QAJob): Promise<ScreenshotResult> {
    const logs: string[] = [];
    const screenshots: string[] = [];

    try {
      logs.push(
        `Starting screenshot processing for Article ID: ${job.articleId}`
      );

      // Step 1: Download GLB file
      logs.push("Downloading GLB file from Google Drive...");
      try {
        const glbBuffer = await this.downloadGLB(job.articleId);
        logs.push(
          `GLB file downloaded successfully: ${glbBuffer.length} bytes`
        );

        // Step 2: Convert to data URL
        const glbDataURL = this.glbBufferToDataURL(glbBuffer);
        logs.push("GLB converted to data URL for model-viewer");

        // Step 3: Launch browser
        logs.push("Launching headless browser...");
        const browser = await puppeteer.launch({
          executablePath: "/usr/bin/chromium-browser",
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-first-run",
            "--no-zygote",
          ],
          headless: true,
        });

        try {
          // Step 4: Take screenshots from different angles
          const angles = ["front", "back", "left", "right", "top"];

          for (const angle of angles) {
            logs.push(`Taking screenshot from ${angle} angle...`);
            try {
              const screenshotUrl = await this.takeScreenshot(
                browser,
                glbDataURL,
                angle,
                job.articleId
              );
              screenshots.push(screenshotUrl);
              logs.push(`✅ ${angle} screenshot completed: ${screenshotUrl}`);
            } catch (error) {
              const errorMsg = `Failed to capture ${angle} screenshot: ${
                error instanceof Error ? error.message : "Unknown error"
              }`;
              logs.push(`❌ ${errorMsg}`);
              console.error(errorMsg);
              // Continue with other angles even if one fails
            }
          }
        } finally {
          await browser.close();
          logs.push("Browser closed");
        }

        if (screenshots.length === 0) {
          throw new Error("No screenshots were successfully captured");
        }

        logs.push(
          `Screenshot processing completed: ${screenshots.length} images generated`
        );
      } catch (downloadError) {
        const errorMsg = `GLB download failed: ${
          downloadError instanceof Error
            ? downloadError.message
            : "Unknown error"
        }`;
        logs.push(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      return { screenshots, processingLogs: logs };
    } catch (error) {
      const errorMsg = `Screenshot processing failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`;
      logs.push(`❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
}

// Export singleton instance
export const screenshotProcessor = new ScreenshotProcessor();
